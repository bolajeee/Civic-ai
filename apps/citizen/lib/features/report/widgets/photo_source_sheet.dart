import 'package:flutter/material.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';

/// Where a photo should come from.
enum PhotoSource { camera, gallery }

/// Asks the citizen to choose between the camera and their photo library.
///
/// Returns null if the sheet is dismissed without a choice.
Future<PhotoSource?> showPhotoSourceSheet(BuildContext context) {
  return showModalBottomSheet<PhotoSource>(
    context: context,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(
        top: Radius.circular(AppConstants.radiusLg),
      ),
    ),
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: AppConstants.spacingSm),

          // Drag handle
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.divider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          const SizedBox(height: AppConstants.spacingMd),

          const Padding(
            padding: EdgeInsets.symmetric(
              horizontal: AppConstants.spacingLg,
            ),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('Add Photo', style: AppTextStyles.label),
            ),
          ),

          const SizedBox(height: AppConstants.spacingSm),

          _SourceTile(
            icon: Icons.photo_camera_outlined,
            title: 'Take Photo',
            subtitle: 'Use your camera to photograph the issue',
            onTap: () => Navigator.of(sheetContext).pop(PhotoSource.camera),
          ),
          _SourceTile(
            icon: Icons.photo_library_outlined,
            title: 'Choose from Gallery',
            subtitle: 'Pick an existing photo from your device',
            onTap: () => Navigator.of(sheetContext).pop(PhotoSource.gallery),
          ),

          const SizedBox(height: AppConstants.spacingSm),
        ],
      ),
    ),
  );
}

class _SourceTile extends StatelessWidget {
  const _SourceTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppConstants.spacingLg,
        vertical: AppConstants.spacingXs,
      ),
      leading: Container(
        width: 44,
        height: 44,
        decoration: const BoxDecoration(
          color: AppColors.primaryLight,
          shape: BoxShape.circle,
        ),
        child: Icon(icon, size: 22, color: AppColors.primary),
      ),
      title: Text(title, style: AppTextStyles.label),
      subtitle: Text(subtitle, style: AppTextStyles.bodySmall),
    );
  }
}
