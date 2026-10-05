export const formatCurrency = (amount) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount || 0);

export const formatDate = (isoString) =>
  isoString
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoString))
    : '—';

// A calendar date ('YYYY-MM-DD', no time), shown without shifting a day across timezones.
export const formatDay = (date) =>
  date ? new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(new Date(`${date}T00:00:00`)) : '—';
