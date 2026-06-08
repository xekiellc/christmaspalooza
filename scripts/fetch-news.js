// ============================================
// ChristmasPalooza — Christmas News Fetcher
// Runs nightly via GitHub Actions
// Writes new stories to Supabase christmas_news
// ============================================

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Search queries — runs all of these and deduplicates by URL
const QUERIES = [
  'Christmas',
  'Christmas movie',
  'Hallmark Christmas',
  'Christmas recipe',
  'Santa Claus',
  'Christmas ornament',
  'Christmas tree',
  'holiday traditions',
];

async function fetchNews(query) {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${from}&sortBy=publishedAt&pageSize=20&language=en&apiKey=${NEWSAPI_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'ok') {
    console.error(`NewsAPI error for "${query}":`, data.message);
    return [];
  }
  return data.articles || [];
}

async function upsertArticle(article) {
  if (!article.url || !article.title) return;
  if (article.url === '[Removed]' || article.title === '[Removed]') return;

  const row = {
    title: article.title.slice(0, 500),
    description: article.description ? article.description.slice(0, 1000) : null,
    url: article.url,
    source: article.source?.name || null,
    image_url: article.urlToImage || null,
    published_at: article.publishedAt || null,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/christmas_news`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'resolution=ignore-duplicates', // skip if URL already exists
    },
    body: JSON.stringify(row),
  });

  if (!res.ok && res.status !== 409) {
    const err = await res.text();
    console.error('Supabase insert error:', res.status, err);
  }
}

async function main() {
  console.log('🎄 Christmas News Pipeline starting...');

  const seen = new Set();
  let total = 0;

  for (const query of QUERIES) {
    console.log(`  Fetching: "${query}"`);
    const articles = await fetchNews(query);

    for (const article of articles) {
      if (!article.url || seen.has(article.url)) continue;
      seen.add(article.url);
      await upsertArticle(article);
      total++;
    }

    // Respect NewsAPI rate limit — 1 req/sec on free tier
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`✅ Done. Processed ${total} articles.`);
}

main().catch(err => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
