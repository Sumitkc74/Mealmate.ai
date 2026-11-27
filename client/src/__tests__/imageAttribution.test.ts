import { describe, it, expect } from 'vitest';
import { getImageAttribution } from '../lib/imageAttribution';

describe('getImageAttribution', () => {
  it('attributes a recorded Wikimedia source', () => {
    const a = getImageAttribution('/static/recipe-images/abc.jpg', 'wikimedia');
    expect(a?.label).toContain('Wikimedia Commons');
    expect(a?.href).toBe('https://commons.wikimedia.org');
  });

  it('attributes a recorded Pollinations source', () => {
    const a = getImageAttribution('/static/recipe-images/abc.jpg', 'pollinations');
    expect(a?.label).toContain('Pollinations.AI');
    expect(a?.href).toBe('https://pollinations.ai');
  });

  it('derives Wikimedia from the URL when no source is recorded', () => {
    const a = getImageAttribution('https://upload.wikimedia.org/wikipedia/commons/1/2/dish.jpg');
    expect(a?.label).toContain('Wikimedia Commons');
  });

  it('derives Pollinations from the URL when no source is recorded', () => {
    const a = getImageAttribution('https://image.pollinations.ai/prompt/a%20bowl%20of%20soup');
    expect(a?.label).toContain('Pollinations.AI');
  });

  it('returns a generic cached-image note for a local path with no recorded source', () => {
    const a = getImageAttribution('/static/recipe-images/abc.jpg');
    expect(a?.label).toContain('cached by MealMate');
    expect(a?.href).toBe('/attributions');
  });

  it('returns null for user-provided images and for no image', () => {
    expect(getImageAttribution('https://example.com/dish.jpg', 'user')).toBeNull();
    expect(getImageAttribution('https://example.com/dish.jpg')).toBeNull();
    expect(getImageAttribution(undefined)).toBeNull();
  });
});
