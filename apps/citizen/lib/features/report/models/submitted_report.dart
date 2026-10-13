import 'ai_classification.dart';
import 'report_category.dart';
import 'report_location.dart';

class SubmittedReportPhoto {
  const SubmittedReportPhoto({
    required this.id,
    required this.mediaType,
    required this.displayOrder,
    this.url,
  });

  final String id;
  final String mediaType;
  final int displayOrder;
  final String? url;

  factory SubmittedReportPhoto.fromJson(Map<String, dynamic> json) =>
      SubmittedReportPhoto(
        id: json['id'] as String,
        mediaType: json['mediaType'] as String,
        displayOrder: (json['displayOrder'] as num?)?.toInt() ?? 0,
        url: json['url'] as String?,
      );
}

class ReportStatusEvent {
  const ReportStatusEvent({
    required this.id,
    required this.status,
    required this.occurredAt,
  });

  final String id;
  final ReportStatus status;
  final DateTime occurredAt;

  factory ReportStatusEvent.fromJson(Map<String, dynamic> json) =>
      ReportStatusEvent(
        id: json['id'] as String,
        status: ReportStatus.fromApi(json['status'] as String?),
        occurredAt: DateTime.parse(json['occurredAt'] as String),
      );
}

/// Lifecycle of a submitted report.
///
/// Mirrors the `report_status` enum in the database. `pending`, `inProgress`
/// and `resolved` are the three badges in the reference design; `rejected` is
/// used by the government review queue.
enum ReportStatus {
  pending('PENDING', 'Pending'),
  inProgress('IN_PROGRESS', 'In Progress'),
  resolved('RESOLVED', 'Resolved'),
  rejected('REJECTED', 'Rejected'),

  /// A status this build does not know about — the app renders it neutrally
  /// rather than mislabelling it as pending.
  unknown('UNKNOWN', 'Unknown');

  const ReportStatus(this.apiValue, this.label);

  final String apiValue;
  final String label;

  static ReportStatus fromApi(String? value) {
    for (final status in values) {
      if (status.apiValue == value) return status;
    }
    return ReportStatus.unknown;
  }
}

/// One row of the citizen's report history, from `GET /api/reports`.
///
/// Read-only: the server owns status and timestamps.
class SubmittedReport {
  const SubmittedReport({
    required this.id,
    required this.publicId,
    required this.status,
    required this.category,
    required this.photoCount,
    this.description,
    this.submittedAt,
    this.location,
    this.thumbnailUrl,
    this.aiClassification,
    this.photos = const [],
    this.events = const [],
    this.priority,
    this.assignedAgency,
    this.citizenReference,
    this.clusterPublicId,
  });

  final String id;

  /// Citizen-facing identifier, e.g. `CR-1000`.
  final String publicId;

  final ReportStatus status;
  final ReportCategory category;
  final int photoCount;
  final String? description;
  final DateTime? submittedAt;
  final ReportLocation? location;

  /// Signed URL for the first photo, valid for a day. Null when the report has
  /// no media or the signature could not be created.
  final String? thumbnailUrl;

  /// The AI's photo check, or null when the server has AI switched off.
  final AiClassification? aiClassification;
  final List<SubmittedReportPhoto> photos;
  final List<ReportStatusEvent> events;
  final String? priority;
  final String? assignedAgency;
  final String? citizenReference;
  final String? clusterPublicId;

  factory SubmittedReport.fromJson(Map<String, dynamic> json) {
    final location = json['location'];
    final ai = json['aiClassification'];
    final photos = json['photos'] as List<dynamic>? ?? const [];
    final events = json['events'] as List<dynamic>? ?? const [];

    return SubmittedReport(
      id: json['id'] as String,
      publicId: json['publicId'] as String,
      status: ReportStatus.fromApi(json['status'] as String?),
      category: ReportCategory.fromJson(
        json['category'] as Map<String, dynamic>,
      ),
      photoCount: (json['photoCount'] as num?)?.toInt() ?? 0,
      description: json['description'] as String?,
      submittedAt: json['submittedAt'] != null
          ? DateTime.tryParse(json['submittedAt'] as String)
          : null,
      location: location is Map<String, dynamic>
          ? ReportLocation.fromJson(location)
          : null,
      thumbnailUrl: json['thumbnailUrl'] as String?,
      aiClassification:
          ai is Map<String, dynamic> ? AiClassification.fromJson(ai) : null,
      photos: photos
          .map((photo) => SubmittedReportPhoto.fromJson(
                photo as Map<String, dynamic>,
              ))
          .toList(growable: false),
      events: events
          .map((event) => ReportStatusEvent.fromJson(
                event as Map<String, dynamic>,
              ))
          .toList(growable: false),
      priority: json['priority'] as String?,
      assignedAgency: json['assignedAgency'] as String?,
      citizenReference: json['citizenReference'] as String?,
      clusterPublicId: json['clusterPublicId'] as String?,
    );
  }
}
