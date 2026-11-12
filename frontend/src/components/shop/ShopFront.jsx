import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../utils/formatters';
import { discountLabel } from '../../utils/discounts';
import { registerPathFor } from '../../utils/afterLogin';
import { COMPANY } from '../../utils/pdfShared';
import { PlaceholderIcon } from '../ui/ProductImageViewer';

// The top of the Products page, like a shop window: a rotating banner, a
// strip of what Tyrotec stands for, quick category buttons and a row of
// featured products. Only on the plain catalogue view -- once someone
// searches or filters, it steps aside for the results.

const SLIDE_MS = 6500;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    setReduced(query.matches);
    const onChange = (e) => setReduced(e.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

function Arrow({ dir }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CtaButton({ cta, primary }) {
  const className = primary
    ? 'inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-black/20 transition-colors duration-150 hover:bg-brand-600 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm'
    : 'inline-flex items-center gap-1.5 rounded-lg border border-white/40 bg-white/10 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm transition-colors duration-150 hover:bg-white/20 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm';
  const label = (
    <>
      {cta.label}
      {primary && <Arrow dir="right" />}
    </>
  );
  if (cta.to) {
    return (
      <Link to={cta.to} className={className}>
        {label}
      </Link>
    );
  }
  if (cta.href) {
    return (
      <a href={cta.href} className={className}>
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={cta.onClick} className={className}>
      {label}
    </button>
  );
}

function PromoCarousel({ slides }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();
  const count = slides.length;

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (paused || reducedMotion || count < 2) return undefined;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, paused, reducedMotion, count]);

  const go = (i) => setIndex((i + count) % count);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Tyrotec highlights"
      className="relative overflow-hidden rounded-2xl bg-ink shadow-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative h-[22rem] sm:h-[17rem] lg:h-[19rem]">
        {slides.map((slide, i) => {
          const active = i === index;
          return (
            <div
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={!active}
              className={`absolute inset-0 transition-[opacity,visibility] duration-700 ease-out ${active ? 'visible opacity-100' : 'pointer-events-none invisible opacity-0'}`}
            >
              <img
                src={slide.image}
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                className={`absolute inset-0 h-full w-full object-cover transition-transform duration-[7000ms] ease-out ${
                  active && !reducedMotion ? 'scale-105' : 'scale-100'
                }`}
                style={{ objectPosition: slide.focus || 'center' }}
              />
              {/* Dark on the left where the words sit, clear on the right where the machine is. */}
              <div className="absolute inset-0 bg-gradient-to-r from-ink/95 via-ink/75 to-ink/10" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />

              {/* Product spotlight: the photo fills a rounded showcase frame (no white
                  mat around it -- product photos come on all kinds of backgrounds),
                  lit by a soft brand-coloured glow, where the machine would be. */}
              {slide.product?.image_url && (
                <div className="absolute right-8 top-1/2 hidden -translate-y-1/2 sm:block lg:right-16">
                  <div className="absolute -inset-6 rounded-full bg-brand/30 blur-3xl" aria-hidden="true" />
                  <div className="relative h-44 w-36 overflow-hidden rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/25 lg:h-52 lg:w-44">
                    <img src={slide.product.image_url} alt={slide.product.name} className="h-full w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" aria-hidden="true" />
                    {slide.product.discount && (
                      <span className="absolute left-2.5 top-2.5 rounded-full bg-good-500 px-2.5 py-1 text-xs font-bold text-white shadow-lg">
                        {discountLabel(slide.product.discount.percent)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className={`relative flex h-full flex-col justify-center px-5 py-5 sm:px-8 sm:py-6 lg:px-10 [&>*]:shrink-0 ${slide.product ? 'sm:pr-60 lg:pr-80' : ''}`}>
                {slide.product?.image_url && (
                  <img
                    src={slide.product.image_url}
                    alt=""
                    className="mb-3 h-16 w-16 rounded-xl object-cover shadow-lg shadow-black/50 ring-1 ring-white/25 sm:hidden"
                  />
                )}
                {slide.logo && (
                  <span className="mb-3 inline-flex w-fit items-center rounded-lg bg-white/95 px-2.5 py-1.5 shadow-md">
                    <img src="/promo/tyrotec-logo.png" alt="Tyrotec (Pty) Ltd" className="h-7 w-auto sm:h-8" />
                  </span>
                )}
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                  <span className="h-0.5 w-6 bg-brand" aria-hidden="true" />
                  {slide.eyebrow}
                </p>
                <h2 className="mt-2 line-clamp-2 max-w-xl font-display text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
                  {slide.title}
                </h2>
                <p className="mt-2 line-clamp-3 max-w-md text-[13px] leading-relaxed text-slate-200 sm:line-clamp-none sm:text-sm">{slide.text}</p>
                {slide.price && (
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xl font-bold text-white sm:text-2xl">{slide.price.now}</span>
                    {slide.price.was && <span className="font-mono text-sm text-slate-400 line-through">{slide.price.was}</span>}
                    <span className="text-xs text-slate-300">{slide.price.note}</span>
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-4 sm:gap-2.5">
                  {slide.ctas.map((cta, n) => (
                    <CtaButton key={cta.label} cta={cta} primary={n === 0} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Previous, the dots, next: together in the corner, clear of the words and the product. */}
      {count > 1 && (
        <div className="absolute bottom-3 right-4 flex items-center gap-2 sm:bottom-4 sm:right-6">
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="hidden rounded-full border border-white/30 bg-ink/40 p-1 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-brand sm:block"
          >
            <Arrow dir="left" />
          </button>
          <div className="flex items-center gap-1.5">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show slide ${i + 1}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'w-6 bg-brand' : 'w-1.5 bg-white/50 hover:bg-white/80'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="hidden rounded-full border border-white/30 bg-ink/40 p-1 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-brand sm:block"
          >
            <Arrow dir="right" />
          </button>
        </div>
      )}
    </section>
  );
}

// What Tyrotec does, in the website's own words.
const PROMISES = [
  {
    title: 'Spare parts supply',
    text: 'Local and global suppliers',
    icon: 'M12 3l7 4v10l-7 4-7-4V7l7-4zM12 12l7-4M12 12v9M12 12L5 8',
  },
  {
    title: 'Hydraulic & electrical',
    text: 'Pumps, motors and valves',
    icon: 'M13 3L5 14h6l-1 7 8-11h-6l1-7z',
  },
  {
    title: 'Component repairs',
    text: 'Repairs and equipment rebuilds',
    icon: 'M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.6-.6-.6-2.6 2.6-2.4z',
  },
  {
    title: 'Based in Rustenburg',
    text: `Mon – Fri 08:00 – 17:00 · ${COMPANY.phone}`,
    icon: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  },
];

function PromiseStrip() {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
      {PROMISES.map((p) => (
        <div key={p.title} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-[18px] w-[18px]" aria-hidden="true">
              <path d={p.icon} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-ink">{p.title}</span>
            <span className="block truncate text-[11px] text-slate-500">{p.text}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CategoryChips({ categories, onPick }) {
  if (!categories.length) return null;
  return (
    <section className="mt-6" aria-labelledby="shop-by-category">
      <h2 id="shop-by-category" className="font-display text-base font-semibold text-ink">
        Shop by category
      </h2>
      <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.name)}
            className="shrink-0 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium capitalize text-ink transition-colors duration-150 hover:border-brand hover:bg-brand/10 hover:text-brand-600"
          >
            {c.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function FeaturedStrip({ products, onAdd, isInCart, onView, onSeeAll }) {
  const scroller = useRef(null);
  if (products.length < 3) return null;

  const scrollBy = (dir) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <section className="mt-6" aria-labelledby="featured-products">
      <div className="flex items-end justify-between gap-3">
        <h2 id="featured-products" className="font-display text-base font-semibold text-ink">
          Featured products
        </h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSeeAll} className="text-xs font-medium text-teal-600 hover:underline">
            See all products
          </button>
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll featured products left"
            className="hidden rounded-full border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 sm:block"
          >
            <Arrow dir="left" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll featured products right"
            className="hidden rounded-full border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 sm:block"
          >
            <Arrow dir="right" />
          </button>
        </div>
      </div>

      <div ref={scroller} className="-mx-1 mt-2 flex snap-x gap-3 overflow-x-auto scroll-smooth px-1 pb-2">
        {products.map((product) => {
          const inCart = isInCart(product.id);
          return (
            <article
              key={product.id}
              className="flex w-40 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card transition-shadow duration-200 hover:shadow-md sm:w-44"
            >
              <button
                type="button"
                onClick={() => onView(product)}
                className="relative block aspect-square w-full shrink-0 cursor-zoom-in bg-white"
                aria-label={`View photo of ${product.name}`}
              >
                {product.image_url ? (
                  // Absolutely placed: a tall photo can't stretch the box, it's fitted inside it.
                  <img src={product.image_url} alt={product.name} loading="lazy" className="absolute inset-0 h-full w-full object-contain p-2" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-slate-50 text-slate-300">
                    <PlaceholderIcon className="h-7 w-7" />
                  </span>
                )}
                {product.discount && (
                  <span className="absolute left-2 top-2 rounded-md bg-good-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {discountLabel(product.discount.percent)}
                  </span>
                )}
              </button>
              <div className="flex flex-1 flex-col border-t border-slate-100 px-2.5 pb-2.5 pt-2">
                <p className="line-clamp-2 text-xs font-medium leading-snug text-ink" title={product.name}>
                  {product.name}
                </p>
                <div className="mt-auto pt-2">
                  {product.discount ? (
                    <p className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-mono text-sm font-semibold text-good-500">{formatCurrency(product.discount.price)}</span>
                      <span className="font-mono text-[10px] text-slate-400 line-through">{formatCurrency(product.unit_price)}</span>
                    </p>
                  ) : (
                    <p className="font-mono text-sm font-semibold text-ink">{formatCurrency(product.unit_price)}</p>
                  )}
                  <p className="text-[10px] text-slate-400">{product.vat_applicable === false ? 'No VAT' : 'excl. VAT'}</p>
                  <button
                    type="button"
                    onClick={() => onAdd(product)}
                    className={`mt-1.5 w-full rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-150 active:scale-[0.98] ${
                      inCart ? 'border border-slate-200 bg-white text-ink hover:bg-slate-50' : 'bg-teal-500 text-white hover:bg-teal-600'
                    }`}
                  >
                    {inCart ? 'Added ✓' : 'Add to quote'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// The banner's spotlight: any product with a photo, at random, so each visit
// shows something different. `random` is injectable for tests.
export function pickSpotlight(products, random = Math.random) {
  const withPhoto = (products || []).filter((p) => p.image_url);
  if (!withPhoto.length) return null;
  return withPhoto[Math.floor(random() * withPhoto.length)];
}

// Products with a photo make the best shop window: deals first, then what's in stock.
export function pickFeatured(discounted, others, max = 10) {
  const seen = new Set();
  const out = [];
  for (const p of [...discounted, ...others.filter((p) => p.stock_quantity > 0)]) {
    if (out.length >= max) break;
    if (!p.image_url || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export default function ShopFront({
  user,
  dealCount,
  categories,
  featured,
  spotlight,
  onViewDeals,
  onPickCategory,
  onShopAll,
  onAdd,
  isInCart,
  onView,
}) {
  const hydraulics = categories.find((c) => /hydraul/i.test(c.name));
  // The spotlight: a product picked at random for this visit (ProductsPage).

  const slides = [
    {
      id: 'brand',
      image: '/promo/hero1.webp',
      focus: '70% center',
      logo: true,
      eyebrow: 'Built for the demands of mining',
      title: 'Engineered to perform.',
      text: 'Reliable spare parts, hydraulic components and repairs that keep your machines moving. Browse, build a quote and order online.',
      ctas: [
        { label: 'Shop products', onClick: onShopAll },
        user ? { label: 'My quotes', to: '/quotes' } : { label: 'Create a free account', to: registerPathFor('/products') },
      ],
    },
  ];
  if (spotlight) {
    const onSale = Boolean(spotlight.discount);
    slides.push({
      id: 'spotlight',
      image: '/promo/photo8.webp',
      focus: '70% 30%',
      product: spotlight,
      eyebrow: onSale ? `On sale · ${discountLabel(spotlight.discount.percent)}` : 'Featured product',
      title: spotlight.name,
      text: [spotlight.category, spotlight.stock_quantity > 0 ? 'In stock and ready to go' : 'Available to order']
        .filter(Boolean)
        .join(' · '),
      price: {
        now: formatCurrency(onSale ? spotlight.discount.price : spotlight.unit_price),
        was: onSale ? formatCurrency(spotlight.unit_price) : null,
        note: spotlight.vat_applicable === false ? 'No VAT' : 'excl. VAT',
      },
      ctas: [
        { label: isInCart(spotlight.id) ? 'Added to quote ✓' : 'Add to quote', onClick: () => onAdd(spotlight) },
        { label: 'See more products', onClick: onShopAll },
      ],
    });
  }
  if (dealCount > 0) {
    slides.push({
      id: 'deals',
      image: '/promo/photo7.webp',
      focus: '60% 70%',
      eyebrow: 'Deals',
      title: `${dealCount} product${dealCount === 1 ? '' : 's'} on discount`,
      text: 'Limited-time prices across the catalogue. Grab them while the discount lasts.',
      ctas: [{ label: 'View deals', onClick: onViewDeals }],
    });
  }
  slides.push(
    {
      id: 'hydraulics',
      image: '/promo/hero3.webp',
      focus: '60% center',
      eyebrow: 'Hydraulic & electrical',
      title: 'Pumps, motors, valves and more.',
      text: 'Hydraulic and electrical components that meet original performance specifications, from global manufacturers.',
      ctas: [
        hydraulics
          ? { label: `Shop ${hydraulics.name.toLowerCase()}`, onClick: () => onPickCategory(hydraulics.name) }
          : { label: 'Shop products', onClick: onShopAll },
        { label: `Call ${COMPANY.phone}`, href: `tel:${COMPANY.phone.replace(/\s/g, '')}` },
      ],
    },
    {
      id: 'spares',
      image: '/promo/photo5.webp',
      focus: 'center 60%',
      eyebrow: 'Spare parts supply',
      title: 'Keep your fleet moving.',
      text: "Maintenance spare parts sourced from reputable local and global suppliers. Can't find a part? Ask us and we'll source it.",
      ctas: [
        { label: 'Browse spare parts', onClick: onShopAll },
        { label: 'Email the sales team', href: `mailto:${COMPANY.email}?subject=${encodeURIComponent('Part enquiry')}` },
      ],
    },
    {
      id: 'repairs',
      image: '/promo/photo3.webp',
      focus: '75% 60%',
      eyebrow: 'Component repairs & rebuilds',
      title: 'Extend the life of critical assets.',
      text: 'Component repairs and equipment rebuilds that keep your equipment available and your costs down.',
      ctas: [
        { label: 'Enquire about a repair', href: `mailto:${COMPANY.email}?subject=${encodeURIComponent('Component repair enquiry')}` },
        { label: `Call ${COMPANY.phone}`, href: `tel:${COMPANY.phone.replace(/\s/g, '')}` },
      ],
    }
  );

  return (
    <div className="mt-5">
      <PromoCarousel slides={slides} />
      <PromiseStrip />
      <CategoryChips categories={categories} onPick={onPickCategory} />
      <FeaturedStrip products={featured} onAdd={onAdd} isInCart={isInCart} onView={onView} onSeeAll={onShopAll} />
    </div>
  );
}
