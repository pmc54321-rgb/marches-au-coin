
// Marchés Au Coin — improved market search
const express = require('express');
const path = require('path');
const marketDatabase = require('./markets.json');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SEARCH_KEY = process.env.SEARCH_API_KEY;
const MAP_KEY = process.env.GOOGLE_MAPS_API_KEY;
const NATIONAL_MARKETS_URL =
  'https://regionsgourmandes.fr/wp-json/rg/v1/marches';
const weekdays = [
  'dimanche', 'lundi', 'mardi', 'mercredi',
  'jeudi', 'vendredi', 'samedi'
];

function distanceKm(a, b) {
  const rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) *
    Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function geocode(address) {
  const url = new URL(
    'https://maps.googleapis.com/maps/api/geocode/json'
  );
  url.searchParams.set('address', address);
  url.searchParams.set('components', 'country:FR');
  url.searchParams.set('key', MAP_KEY);

  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== 'OK' || !data.results?.length) {
    return null;
  }
  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    address: result.formatted_address
  };
}

async function webSearch(query) {
  const response = await fetch(
    'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: {
        'X-API-KEY': SEARCH_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        gl: 'fr',
        hl: 'fr',
        num: 10
      })
    }
  );
  if (!response.ok) throw Error('Recherche indisponible');
  const data = await response.json();
  return data.organic || [];
}

function nextThreeDays() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const part = name =>
    Number(parts.find(x => x.type === name).value);

  const start = Date.UTC(
    part('year'), part('month') - 1, part('day'), 12
  );

  return [0, 1, 2].map(
    i => new Date(start + i * 86400000)
  );
}

function extractTown(title) {
  const match = title.match(
    /marché (?:hebdomadaire |alimentaire |de producteurs )?(?:de |d'|à )([\p{L}' -]{3,45})/iu
  );
  if (!match) return null;
  return match[1]
    .split(/\s+[|–—-]\s+/)[0]
    .trim();
}

function matchesDay(text, day) {
  const expression = new RegExp(
    '(?:chaque|tous les|le|les|marché du)\\s+' +
    day + 's?\\b',
    'i'
  );
  return expression.test(text);
}

app.post('/api/markets', async (req, res) => {
  try {
    const radius = Math.min(
      100, Math.max(1, Number(req.body.radius_km) || 20)
    );

    let origin;
    let reference;

    if (req.body.coords &&
        Number.isFinite(Number(req.body.coords.lat)) &&
        Number.isFinite(Number(req.body.coords.lng))) {
      origin = {
        lat: Number(req.body.coords.lat),
        lng: Number(req.body.coords.lng)
      };
      reference = 'Position actuelle';
    } else {
      const input = String(req.body.location || '').trim();
      if (!input) {
        return res.status(400).json({
          error: 'Veuillez indiquer une commune ou un code postal.'
        });
      }
      const address = /france/i.test(input)
        ? input : input + ', France';
      const found = await geocode(address);
      if (!found) {
        return res.status(400).json({
          error: 'Localité introuvable en France.'
        });
      }
      origin = found;
      reference = found.address;
    }

    const days = nextThreeDays();
    const results = [];
    const seen = new Set();

    const queries = [
      `marché hebdomadaire jours horaires ${reference} France`,
      `marchés alimentaires communes proches ${reference} France`
    ];

    for (const query of queries) {
      const pages = await webSearch(query);

      for (const page of pages) {
        const title = String(page.title || '');
        const snippet = String(page.snippet || '');
        const evidence = title + ' ' + snippet;
        const link = String(page.link || '');

        if (!/marché/i.test(evidence)) continue;
        if (/vide.grenier|brocante|marché de noël|immobilier/i
            .test(evidence)) continue;
        if (!/^https:\/\//.test(link)) continue;

        const town = extractTown(title);
        if (!town) continue;

        const key = town.toLowerCase() + '|' + link;
        if (seen.has(key)) continue;
        seen.add(key);

        let place;
        try {
          place = await geocode(town + ', France');
        } catch {
          continue;
        }
        if (!place) continue;

        const distance = distanceKm(origin, place);
        if (distance > radius) continue;

        const matchingDays = days.filter(date =>
          matchesDay(evidence, weekdays[date.getUTCDay()])
        );
        if (!matchingDays.length) continue;

        results.push({
          name: title,
          town,
          location: place.address,
          address: place.address,
          hours: 'Horaires à vérifier auprès de la source',
          type: 'Marché hebdomadaire (source web)',
          distance_km: Math.round(distance * 10) / 10,
          source_url: link,
          weekdays: matchingDays.map(d => d.getUTCDay())
        });
      }
    }
// Add established weekly markets from our database
for (const market of marketDatabase.markets) {
  const matchingDays = days.filter(date =>
    market.days.includes(weekdays[date.getUTCDay()])
  );

  if (!matchingDays.length) continue;

  const place = await geocode(market.town + ', France');
  if (!place) continue;

  const distance = distanceKm(origin, place);
  if (distance > radius) continue;

  results.push({
    name: market.name,
    town: market.town,
    location: place.address,
    address: place.address,
    hours: market.hours,
    type: 'Marché hebdomadaire',
    distance_km: Math.round(distance * 10) / 10,
    source_url: '',
    weekdays: matchingDays.map(date => date.getUTCDay())
  });
}
    const output = days.map(date => ({
      label: new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC'
      }).format(date),
      markets: results
        .filter(m => m.weekdays.includes(date.getUTCDay()))
        .map(({ weekdays, ...market }) => market)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, 12)
    }));

    res.json({
      reference,
      days: output,
      note: 'Jours indicatifs : vérifiez les horaires auprès de la source.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || 'Erreur de recherche'
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log('Marchés Au Coin running on port ' + PORT);
});
