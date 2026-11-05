import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../shared/data/report_categories.dart';
import '../providers/report_draft_provider.dart';

/// The category picker.
///
/// The list comes from the API rather than a hardcoded table, because the
/// submission carries the server's category UUID. What is hardcoded is the
/// icon — a presentation detail the API has no business knowing — and that
/// table lives in `shared/data/report_categories.dart` so the report cards and
/// this grid cannot disagree about which icon a pothole gets.
class CategoryGrid extends StatelessWidget {
  const CategoryGrid({super.key});

  @override
  Widget build(BuildContext context) {
    final draft = context.watch<ReportDraftProvider>();

    if (draft.isLoadingCategories && !draft.hasCategories) {
      return const _CategoryStatus(
        child: SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(
            strokeWidth: 2.5,
            color: AppColors.primary,
          ),
        ),
      );
    }

    // Only surface the error when there is nothing to show — a failed refresh
    // should not hide a list the citizen can still use.
    if (!draft.hasCategories) {
      return _CategoryStatus(
        child: Column(
          children: [
            Text(
              draft.categoriesError ?? 'No categories available.',
              style: AppTextStyles.bodySmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppConstants.spacingSm),
            TextButton(
              onPressed: () =>
                  context.read<ReportDraftProvider>().loadCategories(),
              style: TextButton.styleFrom(
                minimumSize: Size.zero,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppConstants.spacingSm,
                ),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Retry', style: AppTextStyles.link),
            ),
          ],
        ),
      );
    }

    final categories = draft.categories;

    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: AppConstants.spacingSm,
      crossAxisSpacing: AppConstants.spacingSm,
      childAspectRatio: 1.25,
      children: [
        for (final category in categories)
          _CategoryTile(
            label: category.label,
            icon: reportCategoryById(category.slug).icon,
            isSelected: draft.category == category,
            onTap: () =>
                context.read<ReportDraftProvider>().selectCategory(category),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.label,
    required this.icon,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    // Selection is carried by colour, border weight and an icon tint together:
    // a tint alone is easy to miss, and colour alone is not available to every
    // citizen.
    final foreground = isSelected ? AppColors.primary : AppColors.textSecondary;

    return Semantics(
      button: true,
      selected: isSelected,
      label: label,
      child: Material(
        color: isSelected ? AppColors.primaryLight : AppColors.surface,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppConstants.radiusMd),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppConstants.radiusMd),
              border: Border.all(
                color: isSelected ? AppColors.primary : AppColors.inputBorder,
                width: isSelected ? 1.5 : 1,
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 22, color: foreground),
                const SizedBox(height: AppConstants.spacingXs),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Text(
                    label,
                    style: AppTextStyles.bodySmall.copyWith(
                      color: isSelected
                          ? AppColors.primaryDark
                          : AppColors.textSecondary,
                      fontWeight:
                          isSelected ? FontWeight.w600 : FontWeight.w400,
                    ),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Loading / error shell — keeps the section the same height as the grid so the
// form below it does not jump when the categories arrive.
// ---------------------------------------------------------------------------

class _CategoryStatus extends StatelessWidget {
  const _CategoryStatus({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      height: 120,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: AppConstants.spacingMd),
      child: child,
    );
  }
}
