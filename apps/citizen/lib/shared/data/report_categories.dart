import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';

/// Visual identity for a civic-issue category.
///
/// Used by the Report screen (selectable tiles) and by report cards
/// (icon fallback + sample thumbnail).
class ReportCategoryVisual {
  const ReportCategoryVisual({
    required this.id,
    required this.title,
    required this.icon,
    required this.accent,
    required this.accentLight,
    required this.sampleImageUrl,
  });

  final String id;
  final String title;
  final IconData icon;
  final Color accent;
  final Color accentLight;

  /// Placeholder evidence photo that matches this category.
  final String sampleImageUrl;
}

const List<ReportCategoryVisual> kReportCategories = [
  ReportCategoryVisual(
    id: 'pothole',
    title: 'Pothole',
    icon: Icons.image_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
    sampleImageUrl:
        'https://images.unsplash.com/photo-1515165562839-978bbcf18277?w=224&h=224&fit=crop',
  ),
  ReportCategoryVisual(
    id: 'flooding',
    title: 'Flooding',
    icon: Icons.umbrella_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
    sampleImageUrl:
        'https://images.unsplash.com/photo-1547683905-f686c993aae5?w=224&h=224&fit=crop',
  ),
  ReportCategoryVisual(
    id: 'streetlight',
    title: 'Streetlight',
    icon: Icons.wb_sunny_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
    sampleImageUrl:
        'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=224&h=224&fit=crop',
  ),
  ReportCategoryVisual(
    id: 'waste',
    title: 'Waste',
    icon: Icons.delete_outline_rounded,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
    sampleImageUrl:
        'https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=224&h=224&fit=crop',
  ),
  ReportCategoryVisual(
    id: 'waterLeak',
    title: 'Water Leak',
    icon: Icons.water_drop_outlined,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
    sampleImageUrl:
        'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=224&h=224&fit=crop',
  ),
  ReportCategoryVisual(
    id: 'other',
    title: 'Other',
    icon: Icons.error_outline_rounded,
    accent: AppColors.primary,
    accentLight: AppColors.primaryLight,
    sampleImageUrl:
        'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=224&h=224&fit=crop',
  ),
];

ReportCategoryVisual reportCategoryById(String id) {
  return kReportCategories.firstWhere(
    (c) => c.id == id,
    orElse: () => kReportCategories.last,
  );
}
