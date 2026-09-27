import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../shared/widgets/error_banner.dart';
import '../models/submitted_report.dart';
import '../providers/report_history_provider.dart';

/// "My Reports" — the citizen's own report history, newest first.
///
/// List only. Tapping through to a detail screen, filtering by status and
/// paging past the first twenty are all deliberately absent from this pass.
class ReportHistoryScreen extends StatefulWidget {
  const ReportHistoryScreen({super.key});

  @override
  State<ReportHistoryScreen> createState() => _ReportHistoryScreenState();
}

class _ReportHistoryScreenState extends State<ReportHistoryScreen> {
  @override
  void initState() {
    super.initState();

    // Loaded after the first frame so the spinner and the refresh indicator
    // are mounted before the request starts, and so nothing calls
    // notifyListeners() during this widget's own build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<ReportHistoryProvider>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final history = context.watch<ReportHistoryProvider>();
    final reports = history.reports;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('My Reports'),
        centerTitle: true,
      ),
      body: SafeArea(child: _body(history, reports)),
    );
  }

  Widget _body(ReportHistoryProvider history, List<SubmittedReport> reports) {
    // The spinner only owns the screen on the very first load. Afterwards the
    // list stays put and the refresh indicator does the talking.
    if (history.isLoading && !history.hasLoaded) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.primary),
      );
    }

    if (history.isEmpty) {
      return _EmptyState(
        onRefresh: () => context.read<ReportHistoryProvider>().refresh(),
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => context.read<ReportHistoryProvider>().refresh(),
      child: ListView.separated(
        padding: const EdgeInsets.all(AppConstants.spacingMd),
        physics: const AlwaysScrollableScrollPhysics(),
        // One extra leading row when a refresh failed, so the error sits above
        // the reports instead of replacing them.
        itemCount: reports.length + (history.errorMessage != null ? 1 : 0),
        separatorBuilder: (_, __) =>
            const SizedBox(height: AppConstants.spacingSm),
        itemBuilder: (_, index) {
          if (history.errorMessage != null) {
            if (index == 0) {
              return ErrorBanner(message: history.errorMessage!);
            }
            return _ReportCard(report: reports[index - 1]);
          }
          return _ReportCard(report: reports[index]);
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Report row
// ---------------------------------------------------------------------------

class _ReportCard extends StatelessWidget {
  const _ReportCard({required this.report});

  final SubmittedReport report;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppConstants.spacingSm),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: AppColors.divider),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _Thumbnail(url: report.thumbnailUrl, photoCount: report.photoCount),
          const SizedBox(width: AppConstants.spacingSm),
          Expanded(child: _Details(report: report)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------

class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.url, required this.photoCount});

  static const double _size = 64;

  /// Null when the report has no media or signing failed.
  final String? url;
  final int photoCount;

  @override
  Widget build(BuildContext context) {
    final signedUrl = url;

    return ClipRRect(
      borderRadius: BorderRadius.circular(AppConstants.radiusSm),
      child: SizedBox(
        width: _size,
        height: _size,
        child: signedUrl == null
            ? const _ThumbnailFallback(icon: Icons.image_not_supported_outlined)
            : Image.network(
                signedUrl,
                fit: BoxFit.cover,
                // A signed URL that has expired, or a device that is offline,
                // leaves a placeholder rather than a broken frame.
                errorBuilder: (_, __, ___) =>
                    const _ThumbnailFallback(icon: Icons.broken_image_outlined),
                loadingBuilder: (_, child, progress) {
                  if (progress == null) return child;
                  return const _ThumbnailFallback(isLoading: true);
                },
              ),
      ),
    );
  }
}

class _ThumbnailFallback extends StatelessWidget {
  const _ThumbnailFallback({this.icon, this.isLoading = false});

  final IconData? icon;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.background,
      alignment: Alignment.center,
      child: isLoading
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.inputIcon,
              ),
            )
          : Icon(icon, size: 22, color: AppColors.inputIcon),
    );
  }
}

// ---------------------------------------------------------------------------
// Details column
// ---------------------------------------------------------------------------

class _Details extends StatelessWidget {
  const _Details({required this.report});

  final SubmittedReport report;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                report.category.label,
                style: AppTextStyles.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: AppConstants.spacingXs),
            StatusBadge(status: report.status),
          ],
        ),

        const SizedBox(height: 2),

        Text(report.publicId, style: AppTextStyles.bodySmall),

        if (report.location != null) ...[
          const SizedBox(height: AppConstants.spacingXs),
          Row(
            children: [
              const Icon(
                Icons.location_on_outlined,
                size: 13,
                color: AppColors.inputIcon,
              ),
              const SizedBox(width: 2),
              Expanded(
                child: Text(
                  report.location!.displayLabel,
                  style: AppTextStyles.bodySmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],

        const SizedBox(height: AppConstants.spacingXs),

        Row(
          children: [
            const Icon(
              Icons.photo_outlined,
              size: 13,
              color: AppColors.inputIcon,
            ),
            const SizedBox(width: 2),
            Text(
              '${report.photoCount}',
              style: AppTextStyles.bodySmall,
            ),
            const Spacer(),
            Text(
              _relativeDate(report.submittedAt),
              style: AppTextStyles.bodySmall,
            ),
          ],
        ),
      ],
    );
  }

  /// Relative for anything recent, absolute once "3 weeks ago" stops being
  /// easier to read than a date.
  static String _relativeDate(DateTime? submittedAt) {
    if (submittedAt == null) return '';

    final now = DateTime.now();
    final local = submittedAt.toLocal();
    final elapsed = now.difference(local);

    if (elapsed.isNegative || elapsed.inMinutes < 1) return 'Just now';
    if (elapsed.inMinutes < 60) return '${elapsed.inMinutes}m ago';
    if (elapsed.inHours < 24) return '${elapsed.inHours}h ago';
    if (elapsed.inDays == 1) return 'Yesterday';
    if (elapsed.inDays < 7) return '${elapsed.inDays}d ago';

    return '${local.day} ${_months[local.month - 1]} ${local.year}';
  }

  static const List<String> _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

/// The Pending / In Progress / Resolved pill from the reference design.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.status});

  final ReportStatus status;

  @override
  Widget build(BuildContext context) {
    final (background, foreground) = switch (status) {
      ReportStatus.pending => (
          AppColors.statusPendingBg,
          AppColors.statusPendingFg,
        ),
      ReportStatus.inProgress => (
          AppColors.statusInProgressBg,
          AppColors.statusInProgressFg,
        ),
      ReportStatus.resolved => (
          AppColors.statusResolvedBg,
          AppColors.statusResolvedFg,
        ),
      ReportStatus.rejected => (
          AppColors.statusRejectedBg,
          AppColors.statusRejectedFg,
        ),
      ReportStatus.unknown => (
          AppColors.statusUnknownBg,
          AppColors.statusUnknownFg,
        ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppConstants.spacingSm,
          vertical: 3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppConstants.radiusSm),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: foreground,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRefresh});

  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    // A scroll view rather than a centred column, so pull-to-refresh still
    // works when there is nothing in the list to pull.
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
          const Icon(
            Icons.assignment_outlined,
            size: 44,
            color: AppColors.inputIcon,
          ),
          const SizedBox(height: AppConstants.spacingMd),
          const Text(
            'No reports yet',
            style: AppTextStyles.heading2,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppConstants.spacingSm),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppConstants.spacingXl),
            child: Text(
              'Reports you submit will appear here, newest first.',
              style: AppTextStyles.bodyMedium,
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}
