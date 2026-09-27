import 'dart:io';

import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../../../shared/widgets/error_banner.dart';
import '../providers/report_draft_provider.dart';
import 'dashed_border.dart';
import 'photo_source_sheet.dart';

/// The "Add Photo" section of the report form.
///
/// Empty, it is a dashed dropzone. Once photos are staged it becomes a
/// horizontal strip of thumbnails, each individually removable, followed by an
/// "Add more photos" tile — hidden once the cap is reached.
class PhotoUploadField extends StatelessWidget {
  const PhotoUploadField({super.key});

  static const double _thumbSize = 110;

  @override
  Widget build(BuildContext context) {
    final draft = context.watch<ReportDraftProvider>();
    // `photos` hands back an unmodifiable copy, so read it once per build
    // rather than re-copying inside the item builder.
    final photos = draft.photos;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Header(count: photos.length, max: draft.maxPhotos),

        const SizedBox(height: AppConstants.spacingSm),

        if (photos.isEmpty)
          _EmptyDropzone(
            isBusy: draft.isPicking,
            onTap: draft.isPicking ? null : () => _addPhoto(context),
          )
        else
          SizedBox(
            height: _thumbSize,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: photos.length + (draft.canAddMore ? 1 : 0),
              separatorBuilder: (_, __) =>
                  const SizedBox(width: AppConstants.spacingSm),
              itemBuilder: (_, index) {
                // The trailing slot is the "add more" tile.
                if (index == photos.length) {
                  return _AddMoreTile(
                    size: _thumbSize,
                    isBusy: draft.isPicking,
                    onTap: draft.isPicking ? null : () => _addPhoto(context),
                  );
                }

                final photo = photos[index];
                return _PhotoThumbnail(
                  size: _thumbSize,
                  path: photo.path,
                  formattedSize: photo.formattedSize,
                  onRemove: () =>
                      context.read<ReportDraftProvider>().removePhoto(index),
                );
              },
            ),
          ),

        if (draft.photoErrorMessage != null) ...[
          const SizedBox(height: AppConstants.spacingSm),
          ErrorBanner(message: draft.photoErrorMessage!),
          if (draft.permissionDenied)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: openAppSettings,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppConstants.spacingSm,
                  ),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Open Settings', style: AppTextStyles.link),
              ),
            ),
        ],
      ],
    );
  }

  /// Resolves the picker before the sheet opens, so no [BuildContext] is used
  /// after the await.
  Future<void> _addPhoto(BuildContext context) async {
    final draft = context.read<ReportDraftProvider>();

    final source = await showPhotoSourceSheet(context);
    if (source == null) return;

    switch (source) {
      case PhotoSource.camera:
        await draft.takePhoto();
      case PhotoSource.gallery:
        await draft.chooseFromGallery();
    }
  }
}

// ---------------------------------------------------------------------------
// Section header with counter
// ---------------------------------------------------------------------------

class _Header extends StatelessWidget {
  const _Header({required this.count, required this.max});

  final int count;
  final int max;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        const Text('Add Photo', style: AppTextStyles.label),
        Text(
          '$count of $max',
          style: AppTextStyles.bodySmall,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Empty state — dashed dropzone
// ---------------------------------------------------------------------------

class _EmptyDropzone extends StatelessWidget {
  const _EmptyDropzone({required this.isBusy, required this.onTap});

  final bool isBusy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: CustomPaint(
        painter: const DashedRoundedBorderPainter(
          color: AppColors.inputBorder,
          radius: AppConstants.radiusMd,
        ),
        child: SizedBox(
          width: double.infinity,
          height: 120,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (isBusy)
                const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: AppColors.primary,
                  ),
                )
              else
                const Icon(
                  Icons.add_a_photo_outlined,
                  size: 26,
                  color: AppColors.inputIcon,
                ),
              const SizedBox(height: AppConstants.spacingSm),
              const Padding(
                padding: EdgeInsets.symmetric(
                  horizontal: AppConstants.spacingMd,
                ),
                child: Text(
                  'Upload image of the infrastructure issue',
                  style: AppTextStyles.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Staged photo thumbnail
// ---------------------------------------------------------------------------

class _PhotoThumbnail extends StatelessWidget {
  const _PhotoThumbnail({
    required this.size,
    required this.path,
    required this.formattedSize,
    required this.onRemove,
  });

  final double size;
  final String path;
  final String formattedSize;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          // Photo
          Positioned.fill(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppConstants.radiusMd),
              child: Image.file(
                File(path),
                fit: BoxFit.cover,
                // A photo that failed to decode must not blank the whole form.
                errorBuilder: (_, __, ___) => Container(
                  color: AppColors.background,
                  child: const Icon(
                    Icons.broken_image_outlined,
                    color: AppColors.inputIcon,
                  ),
                ),
              ),
            ),
          ),

          // Size caption along the bottom
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                bottom: Radius.circular(AppConstants.radiusMd),
              ),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 3),
                color: Colors.black.withValues(alpha: 0.55),
                child: Text(
                  formattedSize,
                  style: const TextStyle(
                    fontSize: 10,
                    color: Colors.white,
                    fontWeight: FontWeight.w500,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),

          // Remove control
          Positioned(
            top: -6,
            right: -6,
            child: Semantics(
              button: true,
              label: 'Remove photo',
              child: GestureDetector(
                onTap: onRemove,
                child: Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: AppColors.textPrimary,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.surface, width: 2),
                  ),
                  child: const Icon(
                    Icons.close_rounded,
                    size: 13,
                    color: AppColors.surface,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Trailing "add more" tile
// ---------------------------------------------------------------------------

class _AddMoreTile extends StatelessWidget {
  const _AddMoreTile({
    required this.size,
    required this.isBusy,
    required this.onTap,
  });

  final double size;
  final bool isBusy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: CustomPaint(
        painter: const DashedRoundedBorderPainter(
          color: AppColors.inputBorder,
          radius: AppConstants.radiusMd,
        ),
        child: SizedBox(
          width: size,
          height: size,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (isBusy)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: AppColors.primary,
                  ),
                )
              else
                const Icon(
                  Icons.add_rounded,
                  size: 24,
                  color: AppColors.primary,
                ),
              const SizedBox(height: AppConstants.spacingXs),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 6),
                child: Text(
                  'Add more',
                  style: AppTextStyles.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
