import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_constants.dart';
import '../../core/constants/app_text_styles.dart';
import '../../features/report/models/relative_time.dart';
import '../../features/report/models/submitted_report.dart';
import '../data/report_categories.dart';

// ---------------------------------------------------------------------------
// ReportStatus lives with the model
// (lib/features/report/models/submitted_report.dart) because it mirrors the
// `report_status` column and carries `fromApi`. This file used to declare a
// second, competing enum — pending / inReview / assigned / resolved — whose
// middle two values have no server-side meaning at all, so a status could not
// survive the trip from the API to a badge without a lossy translation.
//
// Only the presentation of a status belongs here, and only as an extension:
// the enum's own `label` is the single source for what a status is called.
// ---------------------------------------------------------------------------

extension ReportStatusVisuals on ReportStatus {
  Color get textColor {
    switch (this) {
      case ReportStatus.pending:
        return AppColors.statusPendingText;
      case ReportStatus.inProgress:
        return AppColors.statusInProgressText;
      case ReportStatus.resolved:
        return AppColors.statusResolvedText;
      case ReportStatus.rejected:
        return AppColors.statusRejectedText;
      case ReportStatus.unknown:
        return AppColors.statusUnknownText;
    }
  }

  Color get bgColor {
    switch (this) {
      case ReportStatus.pending:
        return AppColors.statusPendingBg;
      case ReportStatus.inProgress:
        return AppColors.statusInProgressBg;
      case ReportStatus.resolved:
        return AppColors.statusResolvedBg;
      case ReportStatus.rejected:
        return AppColors.statusRejectedBg;
      case ReportStatus.unknown:
        return AppColors.statusUnknownBg;
    }
  }
}

// ---------------------------------------------------------------------------
// ReportCardData — plain immutable value object.
//
// Fields:
//   id           — the citizen-facing report id, e.g. "CR-2847". It is what
//                  routes carry, so it is `SubmittedReport.publicId`.
//   title        — short description of the issue
//   location     — human-readable address
//   status       — current lifecycle status
//   timeAgo      — human-readable relative time, e.g. "2 hours ago"
//   categoryIcon — fallback icon when imageUrl is null
//   imageUrl     — nullable network URL for the evidence photo. When provided,
//                  the card shows a photo thumbnail instead of the icon box;
//                  when null, the category icon box. Real signed URLs come
//                  from `SubmittedReport.thumbnailUrl`.
//
// The four fields with no backend source yet — priority, assignedAgency,
// citizenReference, and description when the citizen wrote none — default to
// [kNoValue] rather than to a plausible-looking sample. A row that reads "—"
// tells the truth about what the app knows; the Figma sample values it used to
// default to ("Medium", "Pending assignment", "CIV-2026-0000") were
// indistinguishable from real data once on screen.
// ---------------------------------------------------------------------------

class ReportCardData {
  const ReportCardData({
    required this.id,
    required this.title,
    required this.location,
    required this.status,
    required this.timeAgo,
    required this.categoryIcon,
    this.category = 'Other',
    this.description = '',
    this.dateSubmitted = kNoValue,
    this.timeSubmitted = kNoValue,
    this.priority = kNoValue,
    this.assignedAgency = kNoValue,
    this.citizenReference = kNoValue,
    this.iconColor = AppColors.primary,
    this.iconBgColor = AppColors.primaryLight,
    this.imageUrl,
    this.highlighted = false,
  });

  /// Adapts an API report to the card.
  ///
  /// The API has no title column, so the citizen's first line of description
  /// stands in — a card with a heading reads far better than one with an empty
  /// first row, and the first line of a report is almost always its summary.
  /// With no description at all, the category label is the honest fallback.
  factory ReportCardData.fromSubmittedReport(SubmittedReport report) {
    final visual = reportCategoryById(report.category.slug);

    return ReportCardData(
      id: report.publicId,
      title: _titleFor(report),
      location: report.location?.displayLabel ?? 'No location',
      status: report.status,
      timeAgo: relativeTime(report.submittedAt),
      categoryIcon: visual.icon,
      category: report.category.label,
      description: report.description?.trim() ?? '',
      dateSubmitted: formatDate(report.submittedAt),
      timeSubmitted: formatTime(report.submittedAt),
      iconColor: visual.accent,
      iconBgColor: visual.accentLight,
      imageUrl: report.thumbnailUrl,
    );
  }

  /// Long enough to carry a real summary, short enough that the card's single
  /// line does not become the whole paragraph.
  static const int _maxTitleLength = 60;

  static String _titleFor(SubmittedReport report) {
    final description = report.description?.trim() ?? '';
    if (description.isEmpty) return report.category.label;

    final firstLine = description
        .split('\n')
        .map((line) => line.trim())
        .firstWhere((line) => line.isNotEmpty, orElse: () => '');
    if (firstLine.isEmpty) return report.category.label;

    // The card ellipsizes anyway; trimming here keeps `title` a heading rather
    // than a paragraph for anything else that reads it — search, for one.
    return firstLine.length <= _maxTitleLength
        ? firstLine
        : '${firstLine.substring(0, _maxTitleLength).trimRight()}…';
  }

  final String id;
  final String title;
  final String location;
  final ReportStatus status;
  final String timeAgo;
  final IconData categoryIcon;
  final String category;
  final String description;
  final String dateSubmitted;
  final String timeSubmitted;
  final String priority;
  final String assignedAgency;
  final String citizenReference;
  final Color iconColor;
  final Color iconBgColor;

  /// Nullable evidence photo URL/asset path.
  /// • null    → show category icon box
  /// • non-null → show 56×56 image thumbnail with fallback on error
  final String? imageUrl;

  /// When true, the card uses a primary-tinted border to mark selection.
  final bool highlighted;

  ReportCardData copyWith({
    String? id,
    String? title,
    String? location,
    ReportStatus? status,
    String? timeAgo,
    IconData? categoryIcon,
    String? category,
    String? description,
    String? dateSubmitted,
    String? timeSubmitted,
    String? priority,
    String? assignedAgency,
    String? citizenReference,
    Color? iconColor,
    Color? iconBgColor,
    String? imageUrl,
    bool? highlighted,
  }) {
    return ReportCardData(
      id: id ?? this.id,
      title: title ?? this.title,
      location: location ?? this.location,
      status: status ?? this.status,
      timeAgo: timeAgo ?? this.timeAgo,
      categoryIcon: categoryIcon ?? this.categoryIcon,
      category: category ?? this.category,
      description: description ?? this.description,
      dateSubmitted: dateSubmitted ?? this.dateSubmitted,
      timeSubmitted: timeSubmitted ?? this.timeSubmitted,
      priority: priority ?? this.priority,
      assignedAgency: assignedAgency ?? this.assignedAgency,
      citizenReference: citizenReference ?? this.citizenReference,
      iconColor: iconColor ?? this.iconColor,
      iconBgColor: iconBgColor ?? this.iconBgColor,
      imageUrl: imageUrl ?? this.imageUrl,
      highlighted: highlighted ?? this.highlighted,
    );
  }
}

// ---------------------------------------------------------------------------
// ReportCard — reusable card used on Home (recent reports) and History.
//
// Parameters:
//   data        — the report data to display
//   onTap       — optional tap handler
//   showChevron — shows a right-arrow chevron when true (History screen)
// ---------------------------------------------------------------------------

class ReportCard extends StatelessWidget {
  const ReportCard({
    super.key,
    required this.data,
    this.onTap,
    this.showChevron = false,
  });

  final ReportCardData data;
  final VoidCallback? onTap;
  final bool showChevron;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        splashColor: AppColors.primaryLight,
        highlightColor: AppColors.primaryLight.withValues(alpha: 0.5),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
            border: Border.all(
              color: data.highlighted ? AppColors.primary : AppColors.divider,
              width: data.highlighted ? 1.5 : 1.0,
            ),
            boxShadow: [
              BoxShadow(
                color: data.highlighted
                    ? AppColors.primary.withValues(alpha: 0.12)
                    : const Color(0x0A000000),
                blurRadius: data.highlighted ? 12 : 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // ----------------------------------------------------------------
              // Left visual — image thumbnail or category icon box
              // ----------------------------------------------------------------
              _CardThumbnail(data: data),

              const SizedBox(width: 12),

              // ----------------------------------------------------------------
              // Text column
              // ----------------------------------------------------------------
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Title
                    Text(
                      data.title,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                        height: 1.3,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),

                    const SizedBox(height: 4),

                    // Location row
                    Row(
                      children: [
                        const Icon(
                          Icons.location_on_outlined,
                          size: 12,
                          color: AppColors.textSecondary,
                        ),
                        const SizedBox(width: 3),
                        Expanded(
                          child: Text(
                            data.location,
                            style: AppTextStyles.bodySmall,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 6),

                    // Status badge + time ago
                    Row(
                      children: [
                        StatusBadge(status: data.status),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            data.timeAgo,
                            style: AppTextStyles.bodySmall,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              // ----------------------------------------------------------------
              // Optional chevron
              // ----------------------------------------------------------------
              if (showChevron) ...[
                const SizedBox(width: 8),
                const Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: AppColors.textSecondary,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _CardThumbnail
//
// Shows a network/asset image thumbnail when imageUrl is non-null.
// Falls back to the category icon box when imageUrl is null or fails to load.
// Both variants are 56×56, radiusSm (8px) corners — visually balanced.
// ---------------------------------------------------------------------------

class _CardThumbnail extends StatelessWidget {
  const _CardThumbnail({required this.data});

  final ReportCardData data;

  static const double _size = 56;

  @override
  Widget build(BuildContext context) {
    final url = data.imageUrl;

    if (url != null && url.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(AppConstants.radiusSm),
        child: Image.network(
          url,
          width: _size,
          height: _size,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _IconBox(data: data, size: _size),
          loadingBuilder: (_, child, loadingProgress) {
            if (loadingProgress == null) return child;
            return const _LoadingBox(size: _size);
          },
        ),
      );
    }

    return _IconBox(data: data, size: _size);
  }
}

// Category icon fallback — rounded 8px, category icon centred
class _IconBox extends StatelessWidget {
  const _IconBox({required this.data, required this.size});

  final ReportCardData data;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: data.iconBgColor,
        borderRadius: BorderRadius.circular(AppConstants.radiusSm),
      ),
      child: Icon(
        data.categoryIcon,
        size: 26,
        color: data.iconColor,
      ),
    );
  }
}

// Shimmer-like grey placeholder while image is loading
class _LoadingBox extends StatelessWidget {
  const _LoadingBox({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(AppConstants.radiusSm),
      ),
    );
  }
}

/// The status pill from the reference design.
///
/// Public because three screens show one: the report card here, the history
/// list, and the details header. It was private in this file and re-declared
/// privately in each of the other two, which is how the three drifted into
/// disagreeing about padding and corner radius.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});

  final ReportStatus status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: status.bgColor,
        borderRadius: BorderRadius.circular(AppConstants.radiusButton),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: status.textColor,
          height: 1.2,
        ),
      ),
    );
  }
}
