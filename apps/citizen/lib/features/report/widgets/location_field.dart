import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/constants/app_text_styles.dart';
import '../providers/report_draft_provider.dart';
import '../services/location_service.dart';

/// The Location section of the report form.
///
/// Four states, in the order a citizen meets them: not yet asked, resolving,
/// resolved, failed. A failure is guidance rather than a blocker — the report
/// submits without a location, because a citizen indoors still has a pothole
/// worth reporting.
class LocationField extends StatelessWidget {
  const LocationField({super.key});

  @override
  Widget build(BuildContext context) {
    final draft = context.watch<ReportDraftProvider>();
    final location = draft.location;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Surface(
          onTap: draft.isLocating || location != null
              ? null
              : () => context.read<ReportDraftProvider>().captureLocation(),
          child: Row(
            children: [
              _LeadingIcon(
                isBusy: draft.isLocating,
                isResolved: location != null,
              ),
              const SizedBox(width: AppConstants.spacingSm),
              Expanded(child: _Readout(draft: draft)),
              if (draft.isLocating) ...[
                const SizedBox(width: AppConstants.spacingSm),
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ],
          ),
        ),

        if (draft.locationFailure != null) ...[
          const SizedBox(height: AppConstants.spacingSm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.info_outline_rounded,
                size: 15,
                color: AppColors.textSecondary,
              ),
              const SizedBox(width: AppConstants.spacingXs),
              Expanded(
                child: Text(
                  draft.locationFailure!.message,
                  style: AppTextStyles.bodySmall,
                ),
              ),
            ],
          ),
          Row(
            children: [
              TextButton(
                onPressed: () =>
                    context.read<ReportDraftProvider>().captureLocation(),
                style: _compactButtonStyle,
                child: const Text('Try again', style: AppTextStyles.link),
              ),
              if (draft.locationFailure!.requiresSettings)
                TextButton(
                  onPressed: () => context
                      .read<ReportDraftProvider>()
                      .openLocationSettings(),
                  style: _compactButtonStyle,
                  child: const Text('Open Settings', style: AppTextStyles.link),
                ),
            ],
          ),
        ],
      ],
    );
  }

  static final ButtonStyle _compactButtonStyle = TextButton.styleFrom(
    minimumSize: Size.zero,
    padding: const EdgeInsets.symmetric(
      horizontal: AppConstants.spacingSm,
      vertical: AppConstants.spacingXs,
    ),
    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
  );
}

// ---------------------------------------------------------------------------
// Readout — the text inside the field
// ---------------------------------------------------------------------------

class _Readout extends StatelessWidget {
  const _Readout({required this.draft});

  final ReportDraftProvider draft;

  @override
  Widget build(BuildContext context) {
    if (draft.isLocating) {
      return const Text('Finding your location…', style: AppTextStyles.bodyMedium);
    }

    final location = draft.location;
    if (location == null) {
      return const Text(
        'Tap to attach your current location',
        style: AppTextStyles.bodyMedium,
      );
    }

    final accuracy = location.accuracyLabel;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          location.displayLabel,
          style: AppTextStyles.label,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        // The coordinates are always shown alongside the address: they are what
        // the report is actually filed against, and they let the citizen
        // confirm the fix landed where they are standing.
        Text(
          accuracy == null
              ? location.coordinateLabel
              : '${location.coordinateLabel}  ·  $accuracy',
          style: AppTextStyles.bodySmall,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Field chrome
// ---------------------------------------------------------------------------

class _Surface extends StatelessWidget {
  const _Surface({required this.onTap, required this.child});

  final VoidCallback? onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.inputFill,
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppConstants.spacingMd,
            vertical: 14,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
            border: Border.all(color: AppColors.inputBorder),
          ),
          child: child,
        ),
      ),
    );
  }
}

class _LeadingIcon extends StatelessWidget {
  const _LeadingIcon({required this.isBusy, required this.isResolved});

  final bool isBusy;
  final bool isResolved;

  @override
  Widget build(BuildContext context) {
    if (isBusy) {
      return const Icon(
        Icons.my_location_rounded,
        size: 18,
        color: AppColors.primary,
      );
    }

    if (isResolved) {
      return const Icon(
        Icons.check_circle_outline_rounded,
        size: 18,
        color: AppColors.success,
      );
    }

    return const Icon(
      Icons.location_on_outlined,
      size: 18,
      color: AppColors.inputIcon,
    );
  }
}
