/// A report category as served by `GET /api/reports/categories`.
///
/// The identifier is a server-side UUID and must be sent back on submission, so
/// the list is fetched rather than hardcoded in the app.
class ReportCategory {
  const ReportCategory({
    required this.id,
    required this.slug,
    required this.label,
  });

  final String id;
  final String slug;
  final String label;

  factory ReportCategory.fromJson(Map<String, dynamic> json) {
    return ReportCategory(
      id: json['id'] as String,
      slug: json['slug'] as String,
      label: json['label'] as String,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ReportCategory && other.id == id;

  @override
  int get hashCode => id.hashCode;
}
