import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/data/report_categories.dart';
import '../../../shared/widgets/report_card.dart';
import '../models/relative_time.dart';
import '../models/submitted_report.dart';

/// One report, in full.
///
/// Takes the API model rather than the card's view object: this is the screen
/// where the real fields matter, and `SubmittedReport` carries all of them.
class ReportDetailsScreen extends StatelessWidget {
  const ReportDetailsScreen({super.key, required this.report});

  final SubmittedReport report;

  @override
  Widget build(BuildContext context) {
    final visual = reportCategoryById(report.category.slug);
    final description = report.description?.trim() ?? '';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Report Details', style: AppTextStyles.heading2),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          // Guarded: a report opened from a deep link has nothing to pop back
          // to, and `pop()` with an empty stack throws.
          onPressed: () => context.canPop()
              ? context.pop()
              : context.go(AppRoutes.history),
        ),
        actions: [
          IconButton(
            tooltip: 'Share receipt',
            icon: const Icon(Icons.ios_share_rounded),
            onPressed: () => _showReceiptMessage(context),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: AppConstants.spacingXl),
          children: [
            _EvidenceImage(report: report, visual: visual),
            Padding(
              padding: const EdgeInsets.all(AppConstants.spacingMd),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // The category, not the first line of the description:
                      // the API serves no title, and the description is
                      // rendered in full directly below — using it as a heading
                      // too would print the same sentence twice.
                      Expanded(
                        child: Text(
                          report.category.label,
                          style: AppTextStyles.heading2,
                        ),
                      ),
                      const SizedBox(width: AppConstants.spacingSm),
                      StatusBadge(status: report.status),
                    ],
                  ),
                  const SizedBox(height: AppConstants.spacingSm),
                  Text(
                    description.isEmpty
                        ? 'No additional details were provided.'
                        : description,
                    style: AppTextStyles.bodyMedium,
                  ),
                  const SizedBox(height: AppConstants.spacingLg),
                  _DetailsCard(report: report),
                  const SizedBox(height: AppConstants.spacingLg),
                  Text(
                    'Progress timeline',
                    style: AppTextStyles.heading2.copyWith(fontSize: 18),
                  ),
                  const SizedBox(height: AppConstants.spacingSm),
                  _Timeline(status: report.status),
                  const SizedBox(height: AppConstants.spacingLg),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () => _showReceiptMessage(context),
                      icon: const Icon(Icons.receipt_long_outlined),
                      label: const Text('Share receipt'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showReceiptMessage(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Receipt ${report.publicId} is ready to share.'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

class _EvidenceImage extends StatelessWidget {
  const _EvidenceImage({required this.report, required this.visual});

  final SubmittedReport report;
  final ReportCategoryVisual visual;

  @override
  Widget build(BuildContext context) {
    final imageUrl = report.thumbnailUrl;

    // The signed URL expires after a day, so a report opened from a stale list
    // can fail to load. The category icon stands in, as it does on the card.
    Widget fallback() => ColoredBox(
          color: visual.accentLight,
          child: Icon(visual.icon, size: 72, color: visual.accent),
        );

    return SizedBox(
      height: 230,
      width: double.infinity,
      child: imageUrl == null
          ? fallback()
          : Image.network(
              imageUrl,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => fallback(),
            ),
    );
  }
}

class _DetailsCard extends StatelessWidget {
  const _DetailsCard({required this.report});

  final SubmittedReport report;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppConstants.spacingMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        children: [
          _InfoRow(
            icon: Icons.category_outlined,
            label: 'Category',
            value: report.category.label,
          ),
          _InfoRow(
            icon: Icons.tag_outlined,
            label: 'Report ID',
            value: report.publicId,
          ),
          _InfoRow(
            icon: Icons.calendar_today_outlined,
            label: 'Date submitted',
            value: formatDate(report.submittedAt),
          ),
          _InfoRow(
            icon: Icons.schedule_outlined,
            label: 'Time submitted',
            value: formatTime(report.submittedAt),
          ),
          _InfoRow(
            icon: Icons.photo_outlined,
            label: 'Photos',
            value: '${report.photoCount}',
          ),
          _InfoRow(
            icon: Icons.location_on_outlined,
            label: 'Location',
            value: report.location?.displayLabel ?? 'Not recorded',
          ),

          // The next three have no column behind them yet. They keep their
          // place so the card does not silently lose rows when Phase 4 fills
          // them in, and they show [kNoValue] rather than a plausible-looking
          // sample — "Medium" and "Pending assignment" were indistinguishable
          // from real data on screen.
          const _InfoRow(
            icon: Icons.flag_outlined,
            label: 'Priority',
            value: kNoValue,
          ),
          const _InfoRow(
            icon: Icons.account_balance_outlined,
            label: 'Assigned agency',
            value: kNoValue,
          ),
          const _InfoRow(
            icon: Icons.person_pin_outlined,
            label: 'Citizen reference',
            value: kNoValue,
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppColors.primary),
          const SizedBox(width: 10),
          Expanded(child: Text(label, style: AppTextStyles.bodySmall)),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

class _Timeline extends StatelessWidget {
  const _Timeline({required this.status});

  final ReportStatus status;

  static const List<String> _steps = ['Submitted', 'In Progress', 'Resolved'];

  @override
  Widget build(BuildContext context) {
    // A rejected report will never reach Resolved, so drawing it as a stalled
    // journey towards one would be a lie. It gets its own terminal step.
    if (status == ReportStatus.rejected) {
      return const _TimelineSteps(
        steps: ['Submitted', 'Rejected'],
        current: 1,
        isTerminalFailure: true,
      );
    }

    // `unknown` means this build does not recognise the server's status. The
    // report has certainly been submitted; where it goes after that is not
    // something the app can claim, so the timeline stops at Submitted.
    final current = switch (status) {
      ReportStatus.pending => 0,
      ReportStatus.inProgress => 1,
      ReportStatus.resolved => 2,
      ReportStatus.rejected => 1, // unreachable — handled above
      ReportStatus.unknown => 0,
    };

    return _TimelineSteps(steps: _steps, current: current);
  }
}

class _TimelineSteps extends StatelessWidget {
  const _TimelineSteps({
    required this.steps,
    required this.current,
    this.isTerminalFailure = false,
  });

  final List<String> steps;
  final int current;

  /// True when the step at [current] is a failure rather than progress.
  final bool isTerminalFailure;

  bool _isFailureStep(int index) => isTerminalFailure && index == current;

  Color _iconColor(int index) {
    if (_isFailureStep(index)) return AppColors.error;
    return index <= current ? AppColors.primary : AppColors.inputBorder;
  }

  IconData _icon(int index) {
    if (_isFailureStep(index)) return Icons.cancel;
    return index <= current ? Icons.check_circle : Icons.radio_button_unchecked;
  }

  Color _connectorColor(int index) {
    if (isTerminalFailure && index == current - 1) return AppColors.error;
    return index < current ? AppColors.primary : AppColors.inputBorder;
  }

  Color _labelColor(int index) {
    if (_isFailureStep(index)) return AppColors.error;
    return index <= current ? AppColors.textPrimary : AppColors.textSecondary;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < steps.length; i++)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Icon(_icon(i), size: 22, color: _iconColor(i)),
                  if (i < steps.length - 1)
                    Container(width: 2, height: 30, color: _connectorColor(i)),
                ],
              ),
              const SizedBox(width: 12),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  steps[i],
                  style: TextStyle(
                    fontWeight:
                        i == current ? FontWeight.w700 : FontWeight.w500,
                    color: _labelColor(i),
                  ),
                ),
              ),
            ],
          ),
      ],
    );
  }
}
