import 'report_category.dart';

/// Where an AI image check stands, from `aiClassification.status`.
enum AiClassificationStatus {
  pending,
  processing,
  completed,
  failed,
  skipped,

  /// A status this build does not know about — shown as nothing rather than
  /// guessed at.
  unknown;

  static AiClassificationStatus fromApi(String? value) {
    for (final status in values) {
      if (status.name == value) return status;
    }
    return AiClassificationStatus.unknown;
  }
}

/// The AI's suggestion for a report's photo, from `GET /api/reports`.
///
/// A suggestion only: the citizen-selected category stays canonical. The
/// [category] is null when the model was unsure or under the confidence
/// threshold, even for a completed check.
class AiClassification {
  const AiClassification({
    required this.status,
    this.category,
    this.confidence,
    this.evidence,
  });

  final AiClassificationStatus status;
  final ReportCategory? category;

  /// Model-reported score in 0–1. Not a calibrated probability.
  final double? confidence;

  /// One short sentence on what the model saw.
  final String? evidence;

  /// Whole-percent label such as `82%`, or null without a score.
  String? get confidenceLabel {
    final value = confidence;
    if (value == null) return null;
    return '${(value * 100).round()}%';
  }

  bool get isInProgress =>
      status == AiClassificationStatus.pending ||
      status == AiClassificationStatus.processing;

  /// Whether there is anything worth telling the citizen. Failed, skipped and
  /// unrecognised checks are internal — surfacing them only causes worry.
  bool get isVisible =>
      isInProgress || status == AiClassificationStatus.completed;

  factory AiClassification.fromJson(Map<String, dynamic> json) {
    final category = json['category'];
    return AiClassification(
      status: AiClassificationStatus.fromApi(json['status'] as String?),
      category: category is Map<String, dynamic>
          ? ReportCategory.fromJson(category)
          : null,
      confidence: (json['confidence'] as num?)?.toDouble(),
      evidence: json['evidence'] as String?,
    );
  }
}
