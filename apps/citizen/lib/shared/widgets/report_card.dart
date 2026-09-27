import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_constants.dart';
import '../../core/constants/app_text_styles.dart';

// ---------------------------------------------------------------------------
// ReportStatus — drives badge colours throughout the app
// ---------------------------------------------------------------------------

enum ReportStatus { pending, inReview, assigned, resolved }

extension ReportStatusX on ReportStatus {
  String get label {
    switch (this) {
      case ReportStatus.pending:
        return 'Pending';
      case ReportStatus.inReview:
        return 'In Review';
      case ReportStatus.assigned:
        return 'Assigned';
      case ReportStatus.resolved:
        return 'Resolved';
    }
  }

  Color get textColor {
    switch (this) {
      case ReportStatus.pending:
        return AppColors.statusPendingText;
      case ReportStatus.inReview:
      case ReportStatus.assigned:
        return AppColors.statusInProgressText;
      case ReportStatus.resolved:
        return AppColors.statusResolvedText;
    }
  }

  Color get bgColor {
    switch (this) {
      case ReportStatus.pending:
        return AppColors.statusPendingBg;
      case ReportStatus.inReview:
      case ReportStatus.assigned:
        return AppColors.statusInProgressBg;
      case ReportStatus.resolved:
        return AppColors.statusResolvedBg;
    }
  }
}

// ---------------------------------------------------------------------------
// ReportCardData — plain immutable value object.
//
// Fields:
//   id           — report reference number, e.g. "CR-2847"
//   title        — short description of the issue
//   location     — human-readable address
//   status       — current lifecycle status
//   timeAgo      — human-readable relative time, e.g. "2 hours ago"
//   categoryIcon — fallback icon when imageUrl is null
//   imageUrl     — nullable network/asset URL for the evidence photo.
//                  When provided, the card shows a photo thumbnail instead of
//                  the icon box. Set to null for mock data; replaced by real
//                  URLs when the backend is integrated.
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
    this.description = 'This report was submitted by a citizen for local review.',
    this.dateSubmitted = '8 September 2026',
    this.timeSubmitted = '10:30 AM',
    this.priority = 'Medium',
    this.assignedAgency = 'Pending assignment',
    this.citizenReference = 'CIV-2026-0000',
    this.iconColor = AppColors.primary,
    this.iconBgColor = AppColors.primaryLight,
    this.imageUrl,
    this.highlighted = false,
  });

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
                        _StatusBadge(status: data.status),
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

// ---------------------------------------------------------------------------
// _StatusBadge — inline pill badge driven by ReportStatus
// ---------------------------------------------------------------------------

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

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
