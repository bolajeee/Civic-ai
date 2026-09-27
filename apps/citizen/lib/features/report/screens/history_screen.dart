import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/widgets/app_bottom_nav.dart';
import '../../../shared/widgets/error_banner.dart';
import '../../../shared/widgets/report_card.dart';
import '../models/submitted_report.dart';
import '../providers/report_history_provider.dart';

// ---------------------------------------------------------------------------
// Filtering
//
// The filter is a nullable ReportStatus: null is "All". There is deliberately
// no separate filter enum. The one that used to live here had five values —
// all / pending / inReview / assigned / resolved — two of which ("In Review",
// "Assigned") the server has never had, so a citizen could narrow the list to
// a state no report could ever be in.
//
// The server has no status query parameter either, so this filters the loaded
// page client-side. With `fetchHistory` capped at the first twenty reports that
// is honest; it becomes wrong the day the list pages.
// ---------------------------------------------------------------------------

/// Maps a `?filter=` query value to a status.
///
/// Matched against the enum's own `name`, so `/history?filter=pending` and
/// `/history?filter=resolved` — the two links Home's stat cards have always
/// used — keep working, and a future status needs no change here.
ReportStatus? _statusFromQuery(String? raw) {
  if (raw == null) return null;

  for (final status in ReportStatus.values) {
    // `unknown` is not offered as a chip, so honouring it from the query would
    // strand the citizen on a filter they cannot see or clear.
    if (status != ReportStatus.unknown && status.name == raw) return status;
  }

  return null;
}

// ---------------------------------------------------------------------------
// HistoryScreen
// ---------------------------------------------------------------------------

class HistoryScreen extends StatefulWidget {
  /// Optional initial filter passed as a GoRouter query parameter.
  /// e.g. /history?filter=pending
  const HistoryScreen({super.key, this.initialFilter, this.highlightId});

  final String? initialFilter;
  final String? highlightId;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  /// null means "All".
  ReportStatus? _activeFilter;

  @override
  void initState() {
    super.initState();
    _activeFilter = _statusFromQuery(widget.initialFilter);

    // Loaded after the first frame so the spinner is mounted before the request
    // starts, and so nothing notifies listeners during this widget's build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final history = context.read<ReportHistoryProvider>();
      if (!history.hasLoaded) history.load();
    });
  }

  @override
  void didUpdateWidget(HistoryScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The same route rebuilt with a different query — Home's "Pending" stat
    // card pushing onto a History that is already open, for instance.
    if (widget.initialFilter != oldWidget.initialFilter) {
      setState(() => _activeFilter = _statusFromQuery(widget.initialFilter));
    }
  }

  void _setFilter(ReportStatus? value) {
    if (_activeFilter == value) return;
    setState(() => _activeFilter = value);
  }

  List<SubmittedReport> _apply(List<SubmittedReport> reports) {
    final filter = _activeFilter;
    if (filter == null) return reports;
    return reports.where((report) => report.status == filter).toList();
  }

  @override
  Widget build(BuildContext context) {
    final history = context.watch<ReportHistoryProvider>();

    return Scaffold(
      backgroundColor: AppColors.background,
      // -----------------------------------------------------------------------
      // AppBar
      // -----------------------------------------------------------------------
      appBar: AppBar(
        title: const Text('My Reports', style: AppTextStyles.heading2),
        centerTitle: false,
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        // Back arrow — only shown when navigated to from inside the app
        leading: context.canPop()
            ? IconButton(
                icon: const Icon(Icons.arrow_back_rounded),
                onPressed: () => context.pop(),
              )
            : null,
      ),
      // -----------------------------------------------------------------------
      // Body
      // -----------------------------------------------------------------------
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _FilterChipRow(active: _activeFilter, onSelected: _setFilter),

          const Divider(height: 1),

          Expanded(child: _body(history)),
        ],
      ),
      // -----------------------------------------------------------------------
      // Bottom navigation
      // -----------------------------------------------------------------------
      bottomNavigationBar: AppBottomNav(
        currentTab: NavTab.history,
        onTabSelected: (tab) {
          switch (tab) {
            case NavTab.home:
              context.go(AppRoutes.home);
            case NavTab.report:
              context.go(AppRoutes.report);
            case NavTab.history:
              break;
            case NavTab.profile:
              context.go(AppRoutes.profile);
          }
        },
      ),
    );
  }

  Widget _body(ReportHistoryProvider history) {
    // The spinner owns the screen only on the very first load. Afterwards the
    // list stays put and the refresh indicator does the talking.
    if (history.isLoading && !history.hasLoaded) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.primary),
      );
    }

    final reports = _apply(history.reports);

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => context.read<ReportHistoryProvider>().refresh(),
      child: reports.isEmpty
          ? _EmptyState(
              filter: _activeFilter,
              errorMessage: history.errorMessage,
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              // One extra leading row when a refresh failed, so the error sits
              // above the reports rather than replacing them.
              itemCount: reports.length + (history.errorMessage != null ? 1 : 0),
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (_, index) {
                if (history.errorMessage != null) {
                  if (index == 0) {
                    return ErrorBanner(message: history.errorMessage!);
                  }
                  return _card(reports[index - 1]);
                }
                return _card(reports[index]);
              },
            ),
    );
  }

  Widget _card(SubmittedReport report) {
    final isHighlighted =
        widget.highlightId != null && report.publicId == widget.highlightId;

    return ReportCard(
      data: ReportCardData.fromSubmittedReport(report)
          .copyWith(highlighted: isHighlighted),
      showChevron: true,
      onTap: () => context.push(
        AppRoutes.reportDetails.replaceFirst(':id', report.publicId),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _FilterChipRow — horizontally scrollable pill filter chips
// ---------------------------------------------------------------------------

class _FilterChipRow extends StatelessWidget {
  const _FilterChipRow({required this.active, required this.onSelected});

  /// null is the "All" chip.
  final ReportStatus? active;
  final ValueChanged<ReportStatus?> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        child: Row(
          children: [
            _chip(label: 'All', value: null),
            // `unknown` is skipped: it is what the app shows for a status it
            // does not recognise, not something a citizen can filter by.
            for (final status in ReportStatus.values)
              if (status != ReportStatus.unknown)
                _chip(label: status.label, value: status),
          ],
        ),
      ),
    );
  }

  Widget _chip({required String label, required ReportStatus? value}) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: _FilterChip(
        label: label,
        isActive: value == active,
        onTap: () => onSelected(value),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  final String label;
  final bool isActive;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.circular(AppConstants.radiusButton),
          border: Border.all(
            color: isActive ? AppColors.primary : AppColors.inputBorder,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: isActive ? AppColors.surface : AppColors.textSecondary,
            height: 1.2,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _EmptyState — nothing to show, whether from an empty history or a filter
// that matched none of it, or because the load failed outright.
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.filter, this.errorMessage});

  final ReportStatus? filter;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    final String label = filter == null
        ? 'No reports yet'
        : 'No ${filter!.label.toLowerCase()} reports';

    // A scroll view rather than a centred column, so pull-to-refresh still
    // works when there is nothing in the list to pull — which is exactly the
    // state a failed load leaves behind.
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(
        horizontal: AppConstants.spacingXl,
        vertical: AppConstants.spacingLg,
      ),
      children: [
        if (errorMessage != null) ...[
          ErrorBanner(message: errorMessage!),
          const SizedBox(height: AppConstants.spacingXl),
        ],
        const SizedBox(height: 40),
        Center(
          child: Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: AppColors.primaryLight,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.inbox_rounded,
              size: 30,
              color: AppColors.primary,
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'Reports you submit will appear here.',
          style: AppTextStyles.bodyMedium,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
