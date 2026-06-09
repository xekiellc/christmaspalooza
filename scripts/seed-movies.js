// ============================================
// ChristmasPalooza — TMDB Movies & TV Seeder
// Run once (or periodically) via GitHub Actions
// Seeds christmas_movies table in Supabase
// ============================================

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const TMDB_KEY = process.env.TMDB_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TMDB_BASE = 'https://api.themoviedb.org/3';

const CHRISTMAS_KEYWORD_ID = 207317;
const SANTA_KEYWORD_ID = 210425;
const MIN_VOTES = 10;

async function fetchMoviesByKeyword(keywordId, page = 1) {
  const url = `${TMDB_BASE}/discover/movie?api_key=${TMDB_KEY}&with_keywords=${keywordId}&sort_by=popularity.desc&page=${page}&vote_count.gte=${MIN_VOTES}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchTVByKeyword(keywordId, page = 1) {
  const url = `${TMDB_BASE}/discover/tv?api_key=${TMDB_KEY}&with_keywords=${keywordId}&sort_by=popularity.desc&page=${page}&vote_count.gte=${MIN_VOTES}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchAllPages(fetchFn, keywordId, maxPages = 10) {
  const results = [];
  const first = await fetchFn(keywordId, 1);
  if (!first.results) return results;
  results.push(...first.results);
  const totalPages = Math.min(first.total_pages || 1, maxPages);
  for (let p = 2; p <= totalPages; p++) {
    const data = await fetchFn(keywordId, p);
    if (data.results) results.push(...data.results);
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function fetchGenreMaps() {
  const [moviesRes, tvRes] = await Promise.all([
    fetch(`${TMDB_BASE}/genre/movie/list?api_key=${TMDB_KEY}`),
    fetch(`${TMDB_BASE}/genre/tv/list?api_key=${TMDB_KEY}`),
  ]);
  const moviesData = await moviesRes.json();
  const tvData = await tvRes.json();
  const movieMap = {};
  const tvMap = {};
  (moviesData.genres || []).forEach(g => movieMap[g.id] = g.name);
  (tvData.genres || []).forEach(g => tvMap[g.id] = g.name);
  return { movieMap, tvMap };
}

async function getGenreNames(ids, genreMap) {
  return ids.map(id => genreMap[id]).filter(Boolean);
}

async function upsertItem(item, type, genreMap) {
  if (!item.id) return;
  const title = item.title || item.name || '';
  const year = item.release_date
    ? parseInt(item.release_date.slice(0, 4))
    : item.first_air_date
    ? parseInt(item.first_air_date.slice(0, 4))
    : null;
  const row = {
    tmdb_id: item.id,
    title: title.slice(0, 500),
    year,
    overview: item.overview ? item.overview.slice(0, 2000) : null,
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    rating: item.vote_average ? parseFloat(item.vote_average.toFixed(1)) : null,
    genres: await getGenreNames(item.genre_ids || [], genreMap),
    type,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/christmas_movies`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'resolution=ignore-duplicates',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok && res.status !== 409) {
    const err = await res.text();
    console.error(`Supabase error for "${title}":`, res.status, err);
  } else {
    console.log(`  ✓ ${type.toUpperCase()}: ${title} (${year || '?'})`);
  }
}

async function main() {
  console.log('🎄 ChristmasPalooza Movie & TV Seeder starting...');
  const { movieMap, tvMap } = await fetchGenreMaps();

  console.log('\n📽️  Fetching Christmas movies...');
  const movies1 = await fetchAllPages(fetchMoviesByKeyword, CHRISTMAS_KEYWORD_ID, 10);
  const movies2 = await fetchAllPages(fetchMoviesByKeyword, SANTA_KEYWORD_ID, 5);
  const movieDedup = new Map();
  [...movies1, ...movies2].forEach(m => movieDedup.set(m.id, m));
  const allMovies = Array.from(movieDedup.values());
  console.log(`  Found ${allMovies.length} movies`);
  for (const movie of allMovies) {
    await upsertItem(movie, 'movie', movieMap);
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n📺  Fetching Christmas TV shows...');
  const tv1 = await fetchAllPages(fetchTVByKeyword, CHRISTMAS_KEYWORD_ID, 10);
  const tv2 = await fetchAllPages(fetchTVByKeyword, SANTA_KEYWORD_ID, 5);
  const tvDedup = new Map();
  [...tv1, ...tv2].forEach(t => tvDedup.set(t.id, t));
  const allTV = Array.from(tvDedup.values());
  console.log(`  Found ${allTV.length} TV shows`);
  for (const show of allTV) {
    await upsertItem(show, 'tv', tvMap);
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n✅ Seeding complete!');
}

main().catch(err => {
  console.error('Seeder failed:', err);
  process.exit(1);
});
