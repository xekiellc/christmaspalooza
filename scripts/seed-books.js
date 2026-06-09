// ============================================
// ChristmasPalooza — Google Books Seeder
// Run once via GitHub Actions
// Seeds christmas_books table in Supabase
// ============================================

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const BOOKS_KEY = process.env.GOOGLE_BOOKS_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const QUERIES = [
  { q: 'christmas+story+fiction', category: 'fiction' },
  { q: 'christmas+novel', category: 'fiction' },
  { q: 'christmas+romance+novel', category: 'fiction' },
  { q: 'christmas+mystery', category: 'fiction' },
  { q: 'christmas+children+picture+book', category: 'childrens' },
  { q: 'christmas+kids+book', category: 'childrens' },
  { q: 'christmas+cookbook+recipes', category: 'cookbook' },
  { q: 'christmas+baking+book', category: 'cookbook' },
  { q: 'christmas+classic+literature', category: 'classic' },
  { q: 'christmas+carol+dickens', category: 'classic' },
  { q: 'christmas+history+traditions', category: 'nonfiction' },
  { q: 'christmas+decorating+crafts', category: 'nonfiction' },
];

async function fetchBooks(query, startIndex = 0) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=40&startIndex=${startIndex}&key=${BOOKS_KEY}&langRestrict=en`;
  const res = await fetch(url);
  return res.json();
}

function extractISBN(book) {
  const ids = book.volumeInfo?.industryIdentifiers || [];
  const isbn13 = ids.find(i => i.type === 'ISBN_13');
  const isbn10 = ids.find(i => i.type === 'ISBN_10');
  return isbn13?.identifier || isbn10?.identifier || null;
}

function getCoverUrl(book) {
  const imgs = book.volumeInfo?.imageLinks;
  if (!imgs) return null;
  // Use largest available, force https
  const url = imgs.extraLarge || imgs.large || imgs.medium || imgs.thumbnail || imgs.smallThumbnail;
  return url ? url.replace('http://', 'https://') : null;
}

function getPublishedYear(book) {
  const date = book.volumeInfo?.publishedDate;
  if (!date) return null;
  return parseInt(date.slice(0, 4)) || null;
}

function getBuyUrl(book) {
  const isbn = extractISBN(book);
  if (isbn) return `https://bookshop.org/search?keywords=${isbn}`;
  const title = encodeURIComponent(book.volumeInfo?.title || '');
  return `https://bookshop.org/search?keywords=${title}`;
}

async function upsertBook(book, category) {
  const info = book.volumeInfo;
  if (!info?.title) return;

  // Skip books without covers — low quality data
  const coverUrl = getCoverUrl(book);
  if (!coverUrl) return;

  // Skip if title doesn't have christmas relevance
  const titleLower = (info.title + ' ' + (info.description || '')).toLowerCase();
  if (!titleLower.includes('christmas') &&
      !titleLower.includes('holiday') &&
      !titleLower.includes('santa') &&
      !titleLower.includes('winter') &&
      !titleLower.includes('advent') &&
      !titleLower.includes('carol')) return;

  const row = {
    google_id: book.id,
    title: info.title.slice(0, 500),
    author: (info.authors || []).join(', ').slice(0, 300) || null,
    description: info.description ? info.description.slice(0, 1000) : null,
    cover_url: coverUrl,
    isbn: extractISBN(book),
    category,
    buy_url: getBuyUrl(book),
    published_year: getPublishedYear(book),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/christmas_books`, {
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
    console.error(`Supabase error for "${info.title}":`, res.status, err);
  } else {
    console.log(`  ✓ [${category}] ${info.title}`);
  }
}

async function main() {
  console.log('🎄 ChristmasPalooza Books Seeder starting...');

  const seen = new Set();
  let total = 0;

  for (const { q, category } of QUERIES) {
    console.log(`\nFetching: ${q} [${category}]`);

    for (let start = 0; start < 80; start += 40) {
      const data = await fetchBooks(q, start);
      const items = data.items || [];
      if (!items.length) break;

      for (const book of items) {
        if (seen.has(book.id)) continue;
        seen.add(book.id);
        await upsertBook(book, category);
        total++;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✅ Done. Processed ${total} books.`);
}

main().catch(err => {
  console.error('Seeder failed:', err);
  process.exit(1);
});
