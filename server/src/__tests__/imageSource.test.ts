import { deriveImageSource } from '../utils/imageSource';

describe('deriveImageSource', () => {
  it('identifies Wikimedia photo URLs', () => {
    expect(deriveImageSource('https://upload.wikimedia.org/wikipedia/commons/1/2/dish.jpg')).toBe('wikimedia');
    expect(deriveImageSource('https://commons.wikimedia.org/wiki/File:Dish.jpg')).toBe('wikimedia');
    expect(deriveImageSource('https://en.wikipedia.org/wiki/Dish')).toBe('wikimedia');
  });

  it('identifies Pollinations.AI generated images', () => {
    expect(deriveImageSource('https://image.pollinations.ai/prompt/a%20bowl%20of%20soup')).toBe('pollinations');
  });

  it('treats any other remote URL as user-provided', () => {
    expect(deriveImageSource('https://example.com/images/dish.jpg')).toBe('user');
    expect(deriveImageSource('https://images.unsplash.com/photo-123')).toBe('user');
  });

  it('returns undefined for cached local paths (origin rewritten away)', () => {
    expect(deriveImageSource('/static/recipe-images/abc123.jpg')).toBeUndefined();
    expect(deriveImageSource('/images/dish.jpg')).toBeUndefined();
  });

  it('returns undefined for missing or invalid URLs', () => {
    expect(deriveImageSource(undefined)).toBeUndefined();
    expect(deriveImageSource(null)).toBeUndefined();
    expect(deriveImageSource('')).toBeUndefined();
    expect(deriveImageSource('not a url')).toBeUndefined();
  });
});
