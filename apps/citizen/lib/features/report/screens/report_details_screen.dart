import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../shared/widgets/report_card.dart';

class ReportDetailsScreen extends StatelessWidget {
  const ReportDetailsScreen({super.key, required this.report});

  final ReportCardData report;

  @override
  Widget build(BuildContext context) {
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
          onPressed: () => context.pop(),
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
            _EvidenceImage(report: report),
            Padding(
              padding: const EdgeInsets.all(AppConstants.spacingMd),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(report.title, style: AppTextStyles.heading2),
                      ),
                      const SizedBox(width: AppConstants.spacingSm),
                      _StatusBadge(status: report.status),
                    ],
                  ),
                  const SizedBox(height: AppConstants.spacingSm),
                  Text(report.description, style: AppTextStyles.bodyMedium),
                  const SizedBox(height: AppConstants.spacingLg),
                  _DetailsCard(report: report),
                  const SizedBox(height: AppConstants.spacingLg),
                  Text('Progress timeline', style: AppTextStyles.heading2.copyWith(fontSize: 18)),
                  const SizedBox(height: AppConstants.spacingSm),
                  _Timeline(report: report),
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
        content: Text('Receipt ${report.citizenReference} is ready to share.'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

class _EvidenceImage extends StatelessWidget {
  const _EvidenceImage({required this.report});

  final ReportCardData report;

  @override
  Widget build(BuildContext context) {
    final imageUrl = report.imageUrl;
    return SizedBox(
      height: 230,
      width: double.infinity,
      child: imageUrl == null
          ? ColoredBox(
              color: report.iconBgColor,
              child: Icon(report.categoryIcon, size: 72, color: report.iconColor),
            )
          : Image.network(
              imageUrl,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => ColoredBox(
                color: report.iconBgColor,
                child: Icon(report.categoryIcon, size: 72, color: report.iconColor),
              ),
            ),
    );
  }
}

class _DetailsCard extends StatelessWidget {
  const _DetailsCard({required this.report});

  final ReportCardData report;

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
          _InfoRow(icon: Icons.category_outlined, label: 'Category', value: report.category),
          _InfoRow(icon: Icons.tag_outlined, label: 'Report ID', value: report.id),
          _InfoRow(icon: Icons.calendar_today_outlined, label: 'Date submitted', value: report.dateSubmitted),
          _InfoRow(icon: Icons.schedule_outlined, label: 'Time submitted', value: report.timeSubmitted),
          _InfoRow(icon: Icons.location_on_outlined, label: 'Location', value: report.location),
          _InfoRow(icon: Icons.flag_outlined, label: 'Priority', value: report.priority),
          _InfoRow(icon: Icons.account_balance_outlined, label: 'Assigned agency', value: report.assignedAgency),
          _InfoRow(icon: Icons.person_pin_outlined, label: 'Citizen reference', value: report.citizenReference),
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
            child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
          ),
        ],
      ),
    );
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.report});

  final ReportCardData report;

  @override
  Widget build(BuildContext context) {
    final steps = <String>['Submitted', 'In Review', 'Assigned', 'Resolved'];
    final current = switch (report.status) {
      ReportStatus.pending => 0,
      ReportStatus.inReview => 1,
      ReportStatus.assigned => 2,
      ReportStatus.resolved => 3,
    };
    return Column(
      children: [
        for (var i = 0; i < steps.length; i++)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Icon(i <= current ? Icons.check_circle : Icons.radio_button_unchecked, size: 22, color: i <= current ? AppColors.primary : AppColors.inputBorder),
                  if (i < steps.length - 1) Container(width: 2, height: 30, color: i < current ? AppColors.primary : AppColors.inputBorder),
                ],
              ),
              const SizedBox(width: 12),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(steps[i], style: TextStyle(fontWeight: i == current ? FontWeight.w700 : FontWeight.w500, color: i <= current ? AppColors.textPrimary : AppColors.textSecondary)),
              ),
            ],
          ),
      ],
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final ReportStatus status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: status.bgColor, borderRadius: BorderRadius.circular(AppConstants.radiusButton)),
      child: Text(status.label, style: TextStyle(color: status.textColor, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}
