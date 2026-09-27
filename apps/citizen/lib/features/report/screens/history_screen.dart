import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../core/router/app_router.dart';
import '../../../shared/data/mock_reports.dart';
import '../../../shared/widgets/app_bottom_nav.dart';
import '../../../shared/widgets/report_card.dart';

// ---------------------------------------------------------------------------
// _FilterOption — the four chip states
// ---------------------------------------------------------------------------

enum _FilterOption { all, pending, inReview, assigned, resolved }

extension _FilterOptionX on _FilterOption {
  String get label {
    switch (this) {
      case _FilterOption.all:
        return 'All';
      case _FilterOption.pending:
        return 'Pending';
      case _FilterOption.inReview:
        return 'In Review';
      case _FilterOption.assigned:
        return 'Assigned';
      case _FilterOption.resolved:
        return 'Resolved';
    }
  }

  /// Maps a GoRouter query-param string back to the enum value.
  static _FilterOption fromQuery(String? raw) {
    switch (raw) {
      case 'pending':
        return _FilterOption.pending;
      case 'inReview':
        return _FilterOption.inReview;
      case 'assigned':
        return _FilterOption.assigned;
      case 'resolved':
        return _FilterOption.resolved;
      default:
        return _FilterOption.all;
    }
  }

  /// Applies this filter to a list of reports.
  List<ReportCardData> apply(List<ReportCardData> reports) {
    switch (this) {
      case _FilterOption.all:
        return reports;
      case _FilterOption.pending:
        return reports
            .where((r) => r.status == ReportStatus.pending)
            .toList();
      case _FilterOption.inReview:
        return reports.where((r) => r.status == ReportStatus.inReview).toList();
      case _FilterOption.assigned:
        return reports.where((r) => r.status == ReportStatus.assigned).toList();
      case _FilterOption.resolved:
        return reports
            .where((r) => r.status == ReportStatus.resolved)
            .toList();
    }
  }
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
  late _FilterOption _activeFilter;

  @override
  void initState() {
    super.initState();
    _activeFilter = _FilterOptionX.fromQuery(widget.initialFilter);
  }

  @override
  void didUpdateWidget(HistoryScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialFilter != oldWidget.initialFilter) {
      setState(() {
        _activeFilter = _FilterOptionX.fromQuery(widget.initialFilter);
      });
    }
  }

  void _setFilter(_FilterOption f) {
    if (_activeFilter == f) return;
    setState(() => _activeFilter = f);
  }

  List<ReportCardData> get _filtered =>
      _activeFilter.apply(kMockReports.toList());

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;

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
          // Filter chip row
          _FilterChipRow(
            active: _activeFilter,
            onSelected: _setFilter,
          ),

          // Divider below chips
          const Divider(height: 1),

          // Report list or empty state
          Expanded(
            child: filtered.isEmpty
                ? _EmptyState(filter: _activeFilter)
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 16,
                    ),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: 10),
                    itemBuilder: (_, i) {
                      final report = filtered[i];
                      final isHighlighted = widget.highlightId != null &&
                          report.id == widget.highlightId;
                      return ReportCard(
                        data: report.copyWith(highlighted: isHighlighted),
                        showChevron: true,
                        onTap: () {
                          context.push(
                            AppRoutes.reportDetails.replaceFirst(':id', report.id),
                          );
                        },
                      );
                    },
                  ),
          ),
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
}

// ---------------------------------------------------------------------------
// _FilterChipRow — horizontally scrollable pill filter chips
// ---------------------------------------------------------------------------

class _FilterChipRow extends StatelessWidget {
  const _FilterChipRow({
    required this.active,
    required this.onSelected,
  });

  final _FilterOption active;
  final ValueChanged<_FilterOption> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.surface,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 12,
        ),
        child: Row(
          children: _FilterOption.values.map((option) {
            final isActive = option == active;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: _FilterChip(
                label: option.label,
                isActive: isActive,
                onTap: () => onSelected(option),
              ),
            );
          }).toList(),
        ),
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
// _EmptyState — shown when a filter returns no results
// ---------------------------------------------------------------------------

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.filter});

  final _FilterOption filter;

  @override
  Widget build(BuildContext context) {
    final String label = filter == _FilterOption.all
        ? 'No reports yet'
        : 'No ${filter.label.toLowerCase()} reports';

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppConstants.spacingXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
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
            const SizedBox(height: 16),
            Text(
              label,
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
        ),
      ),
    );
  }
}
