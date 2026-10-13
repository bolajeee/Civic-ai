import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/data/report_categories.dart';
import '../../../shared/widgets/report_card.dart';
import '../models/ai_classification.dart';
import '../models/relative_time.dart';
import '../models/report_category.dart';
import '../models/submitted_report.dart';
import '../services/report_service.dart';

/// Loads details independently of history pagination, enabling real deep links.
class ReportDetailsLoaderScreen extends StatefulWidget {
  const ReportDetailsLoaderScreen(
      {super.key, required this.publicId, this.initialReport});
  final String publicId;
  final SubmittedReport? initialReport;

  @override
  State<ReportDetailsLoaderScreen> createState() =>
      _ReportDetailsLoaderScreenState();
}

class _ReportDetailsLoaderScreenState extends State<ReportDetailsLoaderScreen> {
  SubmittedReport? _report;
  String? _error;

  @override
  void initState() {
    super.initState();
    _report = widget.initialReport;
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final report = await ReportService.instance.fetchReport(widget.publicId);
      if (mounted) setState(() => _report = report);
    } on ReportSubmissionException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load this report.');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_report != null) {
      return ReportDetailsScreen(
          report: _report!, refreshError: _error, onRetry: _load);
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Report Details')),
      body: Center(
        child: _error == null
            ? const CircularProgressIndicator()
            : Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.search_off_rounded, size: 40),
                  const SizedBox(height: 16),
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton(
                      onPressed: _load, child: const Text('Try again')),
                  TextButton(
                      onPressed: () => context.go(AppRoutes.history),
                      child: const Text('Back to my reports')),
                ]),
              ),
      ),
    );
  }
}

class ReportDetailsScreen extends StatelessWidget {
  const ReportDetailsScreen(
      {super.key, required this.report, this.refreshError, this.onRetry});
  final SubmittedReport report;
  final String? refreshError;
  final Future<void> Function()? onRetry;

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
          onPressed: () =>
              context.canPop() ? context.pop() : context.go(AppRoutes.history),
        ),
        actions: [
          IconButton(
              tooltip: 'Share receipt',
              icon: const Icon(Icons.ios_share_rounded),
              onPressed: () => _shareReceipt(context)),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: AppConstants.spacingXl),
          children: [
            _EvidenceGallery(report: report, visual: visual),
            Padding(
              padding: const EdgeInsets.all(AppConstants.spacingMd),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (refreshError != null) ...[
                      _LoadWarning(message: refreshError!, onRetry: onRetry),
                      const SizedBox(height: AppConstants.spacingMd),
                    ],
                    Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                              child: Text(report.category.label,
                                  style: AppTextStyles.heading2)),
                          const SizedBox(width: AppConstants.spacingSm),
                          StatusBadge(status: report.status),
                        ]),
                    const SizedBox(height: AppConstants.spacingSm),
                    Text(
                        description.isEmpty
                            ? 'No additional details were provided.'
                            : description,
                        style: AppTextStyles.bodyMedium),
                    const SizedBox(height: AppConstants.spacingLg),
                    _DetailsCard(report: report),
                    if (report.aiClassification?.isVisible ?? false) ...[
                      const SizedBox(height: AppConstants.spacingMd),
                      _AiCheckCard(
                          classification: report.aiClassification!,
                          reportedCategory: report.category),
                    ],
                    const SizedBox(height: AppConstants.spacingLg),
                    Text('Progress timeline',
                        style: AppTextStyles.heading2.copyWith(fontSize: 18)),
                    const SizedBox(height: AppConstants.spacingSm),
                    _Timeline(events: report.events),
                    const SizedBox(height: AppConstants.spacingLg),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        onPressed: () => _shareReceipt(context),
                        icon: const Icon(Icons.receipt_long_outlined),
                        label: const Text('Share receipt'),
                      ),
                    ),
                  ]),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _shareReceipt(BuildContext context) async {
    final box = context.findRenderObject() as RenderBox?;
    try {
      await SharePlus.instance.share(ShareParams(
        title: 'CivicAI report ${report.publicId}',
        subject: 'CivicAI report receipt ${report.publicId}',
        text: 'Receipt for ${report.publicId}',
        files: [
          XFile.fromData(
              Uint8List.fromList(utf8.encode(buildReportReceipt(report))),
              mimeType: 'text/plain')
        ],
        fileNameOverrides: [
          'civicai-${report.publicId.toLowerCase()}-receipt.txt'
        ],
        sharePositionOrigin:
            box == null ? null : box.localToGlobal(Offset.zero) & box.size,
      ));
    } catch (_) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('The receipt could not be shared. Please try again.'),
        behavior: SnackBarBehavior.floating,
      ));
    }
  }
}

String buildReportReceipt(SubmittedReport report) {
  final buffer = StringBuffer()
    ..writeln('CivicAI Report Receipt')
    ..writeln('Report: ${report.publicId}')
    ..writeln('Status: ${report.status.label}')
    ..writeln('Category: ${report.category.label}')
    ..writeln(
        'Submitted: ${formatDate(report.submittedAt)} ${formatTime(report.submittedAt)}')
    ..writeln(
        'Priority: ${_displayValue(report.priority, 'Awaiting assessment')}')
    ..writeln(
        'Assigned agency: ${_displayValue(report.assignedAgency, 'Not assigned')}')
    ..writeln(
        'Citizen reference: ${_displayValue(report.citizenReference, 'Not available')}')
    ..writeln('Location: ${report.location?.displayLabel ?? 'Not recorded'}')
    ..writeln('Photos: ${report.photoCount}');
  if ((report.description ?? '').trim().isNotEmpty) {
    buffer.writeln('Description: ${report.description!.trim()}');
  }
  if (report.events.isNotEmpty) {
    buffer.writeln();
    buffer.writeln('Timeline:');
    for (final event in report.events) {
      buffer.writeln(
          '- ${event.status.label}: ${formatDate(event.occurredAt)} ${formatTime(event.occurredAt)}');
    }
  }
  buffer.writeln();
  buffer.writeln(
      'Generated by CivicAI. This receipt confirms submission and current recorded status.');
  return buffer.toString();
}

String _displayValue(String? value, String fallback) {
  final trimmed = value?.trim() ?? '';
  if (trimmed.isEmpty) return fallback;
  if (!RegExp(r'^[A-Z_]+$').hasMatch(trimmed)) return trimmed;
  return trimmed
      .toLowerCase()
      .split('_')
      .map((part) =>
          part.isEmpty ? part : '${part[0].toUpperCase()}${part.substring(1)}')
      .join(' ');
}

class _LoadWarning extends StatelessWidget {
  const _LoadWarning({required this.message, this.onRetry});
  final String message;
  final Future<void> Function()? onRetry;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: AppColors.error.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(AppConstants.radiusMd)),
        child: Row(children: [
          Expanded(child: Text('$message Showing previously loaded details.')),
          if (onRetry != null)
            TextButton(onPressed: onRetry, child: const Text('Retry')),
        ]),
      );
}

class _EvidenceGallery extends StatefulWidget {
  const _EvidenceGallery({required this.report, required this.visual});
  final SubmittedReport report;
  final ReportCategoryVisual visual;
  @override
  State<_EvidenceGallery> createState() => _EvidenceGalleryState();
}

class _EvidenceGalleryState extends State<_EvidenceGallery> {
  int index = 0;
  @override
  Widget build(BuildContext context) {
    final photos = widget.report.photos;
    if (photos.isEmpty) {
      return SizedBox(height: 230, child: _fallback(widget.visual));
    }
    return Column(children: [
      SizedBox(
        height: 280,
        child: PageView.builder(
          itemCount: photos.length,
          onPageChanged: (value) => setState(() => index = value),
          itemBuilder: (context, photoIndex) => GestureDetector(
            onTap: photos[photoIndex].url == null
                ? null
                : () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => _FullScreenGallery(
                          photos: photos, initialIndex: photoIndex),
                    )),
            child: _networkPhoto(photos[photoIndex], widget.visual),
          ),
        ),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text('${index + 1} of ${photos.length}',
            style: AppTextStyles.bodySmall),
      ),
    ]);
  }
}

class _FullScreenGallery extends StatelessWidget {
  const _FullScreenGallery({required this.photos, required this.initialIndex});
  final List<SubmittedReportPhoto> photos;
  final int initialIndex;
  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
            backgroundColor: Colors.black,
            foregroundColor: Colors.white,
            title: const Text('Report photos')),
        body: PageView.builder(
          controller: PageController(initialPage: initialIndex),
          itemCount: photos.length,
          itemBuilder: (_, index) => InteractiveViewer(
            child: Center(
                child: photos[index].url == null
                    ? const Text('Photo unavailable',
                        style: TextStyle(color: Colors.white))
                    : Image.network(photos[index].url!,
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) => const Text(
                            'Photo unavailable',
                            style: TextStyle(color: Colors.white)))),
          ),
        ),
      );
}

Widget _networkPhoto(SubmittedReportPhoto photo, ReportCategoryVisual visual) {
  if (photo.url == null) return _fallback(visual);
  return Image.network(photo.url!,
      width: double.infinity,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => _fallback(visual));
}

Widget _fallback(ReportCategoryVisual visual) => ColoredBox(
      color: visual.accentLight,
      child: Center(child: Icon(visual.icon, size: 72, color: visual.accent)),
    );

class _DetailsCard extends StatelessWidget {
  const _DetailsCard({required this.report});
  final SubmittedReport report;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(AppConstants.spacingMd),
        decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
            border: Border.all(color: AppColors.divider)),
        child: Column(children: [
          _InfoRow(
              icon: Icons.category_outlined,
              label: 'Category',
              value: report.category.label),
          _InfoRow(
              icon: Icons.tag_outlined,
              label: 'Report ID',
              value: report.publicId),
          _InfoRow(
              icon: Icons.calendar_today_outlined,
              label: 'Date submitted',
              value: formatDate(report.submittedAt)),
          _InfoRow(
              icon: Icons.schedule_outlined,
              label: 'Time submitted',
              value: formatTime(report.submittedAt)),
          _InfoRow(
              icon: Icons.photo_outlined,
              label: 'Photos',
              value: '${report.photoCount}'),
          _InfoRow(
              icon: Icons.location_on_outlined,
              label: 'Location',
              value: report.location?.displayLabel ?? 'Not recorded'),
          _InfoRow(
              icon: Icons.flag_outlined,
              label: 'Priority',
              value: _displayValue(report.priority, 'Awaiting assessment')),
          _InfoRow(
              icon: Icons.account_balance_outlined,
              label: 'Assigned agency',
              value: _displayValue(report.assignedAgency, 'Not assigned')),
          _InfoRow(
              icon: Icons.person_pin_outlined,
              label: 'Citizen reference',
              value: _displayValue(report.citizenReference, 'Not available')),
        ]),
      );
}

class _AiCheckCard extends StatelessWidget {
  const _AiCheckCard(
      {required this.classification, required this.reportedCategory});
  final AiClassification classification;
  final ReportCategory reportedCategory;
  @override
  Widget build(BuildContext context) {
    final suggested = classification.category;
    final confidence = classification.confidenceLabel;
    final suffix = confidence == null ? '' : ' ($confidence confident)';
    final evidence = classification.evidence?.trim() ?? '';
    final headline = classification.isInProgress
        ? 'AI is reviewing your photo…'
        : suggested == null
            ? 'AI could not confidently identify the issue'
            : suggested.id == reportedCategory.id
                ? 'AI agrees this is ${suggested.label}$suffix'
                : 'AI suggests ${suggested.label}$suffix';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppConstants.spacingMd),
      decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppConstants.radiusMd),
          border: Border.all(color: AppColors.divider)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.auto_awesome_outlined,
            size: 18, color: AppColors.primary),
        const SizedBox(width: 10),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(headline,
              style: const TextStyle(
                  fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
          if (!classification.isInProgress && evidence.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(evidence, style: AppTextStyles.bodySmall),
          ],
          const SizedBox(height: 4),
          const Text(
              'Automated check — your selected category stays on record.',
              style: AppTextStyles.bodySmall),
        ])),
      ]),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(
      {required this.icon, required this.label, required this.value});
  final IconData icon;
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 18, color: AppColors.primary),
          const SizedBox(width: 10),
          Expanded(child: Text(label, style: AppTextStyles.bodySmall)),
          const SizedBox(width: 12),
          Flexible(
              child: Text(value,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary))),
        ]),
      );
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.events});
  final List<ReportStatusEvent> events;
  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) {
      return const Text('No lifecycle events have been recorded yet.',
          style: AppTextStyles.bodySmall);
    }
    return Column(children: [
      for (var i = 0; i < events.length; i++)
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Column(children: [
            Icon(
                events[i].status == ReportStatus.rejected
                    ? Icons.cancel
                    : Icons.check_circle,
                size: 22,
                color: events[i].status == ReportStatus.rejected
                    ? AppColors.error
                    : AppColors.primary),
            if (i < events.length - 1)
              Container(width: 2, height: 38, color: AppColors.primary),
          ]),
          const SizedBox(width: 12),
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(events[i].status.label,
                  style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(
                  '${formatDate(events[i].occurredAt)} · ${formatTime(events[i].occurredAt)}',
                  style: AppTextStyles.bodySmall),
            ]),
          ),
        ]),
    ]);
  }
}
