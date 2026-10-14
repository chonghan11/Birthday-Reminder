// A hand-picked list of gift ideas. 

// [id, category, emoji, name, blurb, what to search for]
const IDEAS = [
  ['chocolate-cake', 'cakes', '🍫', 'Chocolate cake', 'A rich classic that suits almost everyone.', 'chocolate cake delivery'],
  ['cheesecake', 'cakes', '🍰', 'Cheesecake', 'Creamy and not too sweet. Great for a small group.', 'cheesecake delivery'],
  ['strawberry-shortcake', 'cakes', '🍓', 'Strawberry shortcake', 'Light sponge with fresh cream and fruit.', 'strawberry shortcake delivery'],
  ['red-velvet', 'cakes', '❤️', 'Red velvet cake', 'Soft, cocoa-tinted and topped with cream cheese frosting.', 'red velvet cake delivery'],
  ['ice-cream-cake', 'cakes', '🍦', 'Ice cream cake', 'A cool treat for a hot day.', 'ice cream cake delivery'],
  ['durian-cake', 'cakes', '🎂', 'Durian cake', 'For the durian fan in your life.', 'durian cake delivery'],
  ['pandan-chiffon', 'cakes', '🌿', 'Pandan chiffon cake', 'Soft, fragrant and light.', 'pandan chiffon cake delivery'],
  ['tiramisu', 'cakes', '☕', 'Tiramisu cake', 'Coffee-flavoured and elegant.', 'tiramisu cake delivery'],
  ['cupcakes', 'cakes', '🧁', 'Cupcake box', 'Easy to share at the office.', 'cupcakes box delivery'],

  ['roses', 'flowers', '🌹', 'Rose bouquet', 'The timeless choice.', 'rose bouquet delivery'],
  ['sunflowers', 'flowers', '🌻', 'Sunflowers', 'Bright and cheerful.', 'sunflower bouquet delivery'],
  ['tulips', 'flowers', '🌷', 'Tulips', 'Fresh, simple and pretty.', 'tulip bouquet delivery'],
  ['mixed-bouquet', 'flowers', '💐', 'Mixed bouquet', 'A colourful mix when you cannot decide.', 'flower bouquet delivery'],
  ['orchid', 'flowers', '🌸', 'Orchid arrangement', 'Long-lasting and elegant.', 'orchid arrangement delivery'],

  ['chocolate-box', 'treats', '🍫', 'Box of chocolates', 'Always welcome.', 'chocolate gift box'],
  ['macarons', 'treats', '🍬', 'Macaron box', 'Small, colourful and pretty to give.', 'macarons gift box'],
  ['cookie-tin', 'treats', '🍪', 'Cookie tin', 'Keeps well, so no rush to eat them.', 'cookie gift tin'],
  ['hamper', 'treats', '🧺', 'Gift hamper', 'A mix of snacks, tea and sweets.', 'gift hamper delivery'],
  ['bubble-tea', 'treats', '🧋', 'Bubble tea treat', 'A casual gift for a friend or colleague.', 'bubble tea delivery'],

  ['dinner', 'experiences', '🍽️', 'Dinner voucher', 'Let them pick the restaurant.', 'restaurant gift voucher'],
  ['spa', 'experiences', '💆', 'Spa voucher', 'For someone who deserves a break.', 'spa gift voucher'],
  ['movies', 'experiences', '🎬', 'Movie tickets', 'A fun night out for two.', 'movie tickets gift'],
  ['cooking-class', 'experiences', '👩‍🍳', 'Cooking class', 'A hands-on gift for food lovers.', 'cooking class gift'],
];

const maps = (term) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(term)}`;
const web = (term) => `https://www.google.com/search?q=${encodeURIComponent(term)}`;

const ITEMS = IDEAS.map(([id, category, emoji, name, blurb, term]) => ({
  id, category, emoji, name, blurb, nearbyLink: maps(term), onlineLink: web(term),
}));

// When nothing in the list matches, offer a search for exactly what the user typed,
// so they are never left at a dead end.
const customIdea = (query) => ({
  id: 'custom',
  category: 'custom',
  custom: true,
  emoji: '🔍',
  name: `Search for "${query}"`,
  blurb: 'Not in our list, but you can look for it nearby or online.',
  nearbyLink: maps(query),
  onlineLink: web(query),
});

function createCuratedCatalog() {
  return {
    // category "all" searches everything; query matches the name, blurb or category.
    async search({ category, query }) {
      const needle = query.toLowerCase();
      const matches = ITEMS.filter((item) => (category === 'all' || item.category === category)
        && `${item.name} ${item.blurb} ${item.category}`.toLowerCase().includes(needle));
      return matches.length === 0 && query ? [customIdea(query)] : matches;
    },
  };
}

module.exports = createCuratedCatalog;
