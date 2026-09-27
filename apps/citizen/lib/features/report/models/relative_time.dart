/// Date and time formatting for report timestamps.
///
/// Hand-written rather than pulled from `intl`: the app needs exactly three
/// formats, all of them fixed to English, and a locale-aware formatter would
/// add a dependency plus an async locale load for no gain at this stage. The
/// one place that decision would have to be revisited is the day this app
/// ships in a language other than English.
library;

const List<String> _months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const List<String> _monthsShort = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// The placeholder for anything the app has no value for — an unparseable
/// timestamp, a field the API does not serve yet. One character, so a row that
/// has no data still reads as a row rather than as a layout bug.
const String kNoValue = '—';

/// Relative for anything recent, absolute once "3 weeks ago" stops being
/// easier to read than a date.
///
/// Returns `''` rather than [kNoValue] for a null timestamp, because the report
/// card renders this inline next to a status badge and an em dash there would
/// read as a missing badge rather than a missing time.
String relativeTime(DateTime? timestamp) {
  if (timestamp == null) return '';

  final now = DateTime.now();
  final local = timestamp.toLocal();
  final elapsed = now.difference(local);

  // A device clock running slightly ahead of the server's would otherwise
  // render "-1m ago". Anything at or beyond now reads as just now.
  if (elapsed.isNegative || elapsed.inMinutes < 1) return 'Just now';
  if (elapsed.inMinutes < 60) return '${elapsed.inMinutes}m ago';
  if (elapsed.inHours < 24) return '${elapsed.inHours}h ago';
  if (elapsed.inDays == 1) return 'Yesterday';
  if (elapsed.inDays < 7) return '${elapsed.inDays}d ago';

  return '${local.day} ${_monthsShort[local.month - 1]} ${local.year}';
}

/// `24 September 2026` — the date as written on the details screen.
String formatDate(DateTime? timestamp) {
  if (timestamp == null) return kNoValue;

  final local = timestamp.toLocal();
  return '${local.day} ${_months[local.month - 1]} ${local.year}';
}

/// `8:42 AM` — the local wall-clock time the report was filed.
String formatTime(DateTime? timestamp) {
  if (timestamp == null) return kNoValue;

  final local = timestamp.toLocal();
  // Midnight and noon are 12 AM and 12 PM, not 0 AM and 0 PM.
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute.toString().padLeft(2, '0');
  final meridiem = local.hour < 12 ? 'AM' : 'PM';

  return '$hour:$minute $meridiem';
}
