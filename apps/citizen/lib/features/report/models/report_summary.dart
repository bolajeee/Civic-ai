class ReportSummary {
  const ReportSummary(
      {required this.total,
      required this.pending,
      required this.inProgress,
      required this.resolved,
      required this.rejected});

  final int total;
  final int pending;
  final int inProgress;
  final int resolved;
  final int rejected;

  factory ReportSummary.fromJson(Map<String, dynamic> json) {
    int count(String key) {
      final value = json[key];
      if (value is! int || value < 0) {
        throw FormatException('Invalid report summary field: $key');
      }
      return value;
    }

    return ReportSummary(
        total: count('total'),
        pending: count('pending'),
        inProgress: count('inProgress'),
        resolved: count('resolved'),
        rejected: count('rejected'));
  }
}
