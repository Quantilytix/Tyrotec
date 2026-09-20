// Reading a yes/no environment variable.
//
// Deliberately forgiving: these are typed by hand into a hosting dashboard,
// where " true" (a stray space), "TRUE" or "1" all clearly mean yes. A strict
// === 'true' silently disabled the reservation jobs in production because the
// stored value had a leading space, and nothing in the logs said why.
function isEnabled(value) {
  const normalised = String(value ?? '').trim().toLowerCase();
  return normalised === 'true' || normalised === '1' || normalised === 'yes' || normalised === 'on';
}

module.exports = { isEnabled };
