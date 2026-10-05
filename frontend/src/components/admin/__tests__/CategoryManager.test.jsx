import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import CategoryManager from '../CategoryManager';

// Rendering is enough to catch a handler the markup refers to but the
// component no longer defines (that broke "Manage categories" once).
describe('CategoryManager', () => {
  const noop = async () => {};

  it('renders the add form and each category with a Remove button', () => {
    const html = renderToString(
      <CategoryManager categories={[{ id: 'c1', name: 'Hydraulic Valves' }, { id: 'c2', name: 'Filters' }]} onAdd={noop} onRemove={noop} />,
    );
    expect(html).toContain('New category name');
    expect(html).toContain('Hydraulic Valves');
    expect(html).toContain('Filters');
    expect(html.match(/Remove/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the empty state', () => {
    const html = renderToString(<CategoryManager categories={[]} onAdd={noop} onRemove={noop} />);
    expect(html).toContain('No categories yet');
  });
});
