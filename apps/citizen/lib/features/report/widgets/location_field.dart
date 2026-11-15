import '../../../core/theme/app_colors_extension.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/app_constants.dart';
import '../models/report_location.dart';
import '../providers/report_draft_provider.dart';
import '../screens/location_picker_screen.dart';
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
    final candidate = draft.locationCandidate;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Surface(
          onTap: draft.isLocating || location != null || candidate != null
              ? null
              : () => context.read<ReportDraftProvider>().captureLocation(),
          child: Row(
            children: [
              _LeadingIcon(
                isBusy: draft.isLocating,
                isResolved: location != null || candidate != null,
              ),
              const SizedBox(width: AppConstants.spacingSm),
              Expanded(child: _Readout(draft: draft)),
              if (draft.isLocating) ...[
                const SizedBox(width: AppConstants.spacingSm),
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: context.colors.primary,
                  ),
                ),
              ],
            ],
          ),
        ),
        if (candidate != null) ...[
          const SizedBox(height: AppConstants.spacingSm),
          _LocationConfirmation(
            location: candidate,
            isBusy: draft.isConfirmingLocation || draft.isLocating,
          ),
        ],
        // Manual entry is always one tap away — GPS indoors can take a while,
        // and a confirmed location can still be wrong.
        if (candidate == null && draft.locationFailure == null)
          Padding(
            padding: const EdgeInsets.only(top: AppConstants.spacingXs),
            child: _PickManuallyButton(
              label: location != null ? 'Change location' : 'Choose on map',
            ),
          ),
        if (draft.locationFailure != null) ...[
          const SizedBox(height: AppConstants.spacingSm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.info_outline_rounded,
                size: 15,
                color: context.colors.textSecondary,
              ),
              const SizedBox(width: AppConstants.spacingXs),
              Expanded(
                child: Text(
                  draft.locationFailure!.message,
                  style: context.textStyles.bodySmall,
                ),
              ),
            ],
          ),
          Wrap(
            children: [
              TextButton(
                onPressed: () =>
                    context.read<ReportDraftProvider>().captureLocation(),
                style: _compactButtonStyle,
                child: Text('Try again', style: context.textStyles.link),
              ),
              const _PickManuallyButton(label: 'Choose on map'),
              if (draft.locationFailure!.requiresSettings)
                TextButton(
                  onPressed: () => context
                      .read<ReportDraftProvider>()
                      .openLocationSettings(),
                  style: _compactButtonStyle,
                  child: Text('Open Settings', style: context.textStyles.link),
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

/// Opens the manual picker, seeded with whatever location the draft already
/// has, and hands the result back to the draft.
Future<void> _pickManually(BuildContext context) async {
  final draft = context.read<ReportDraftProvider>();
  final picked = await LocationPickerScreen.open(
    context,
    initial: draft.location ?? draft.locationCandidate,
  );
  if (picked != null) await draft.useManualLocation(picked);
}

class _PickManuallyButton extends StatelessWidget {
  const _PickManuallyButton({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final busy = context.select<ReportDraftProvider, bool>(
        (draft) => draft.isConfirmingLocation);
    return TextButton.icon(
      onPressed: busy ? null : () => _pickManually(context),
      style: LocationField._compactButtonStyle,
      icon: Icon(Icons.map_outlined, size: 16, color: context.colors.primary),
      label: Text(label, style: context.textStyles.link),
    );
  }
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
      return Text('Finding your location…',
          style: context.textStyles.bodyMedium);
    }

    final location = draft.location ?? draft.locationCandidate;
    if (location == null) {
      return Text(
        'Tap to attach your current location',
        style: context.textStyles.bodyMedium,
      );
    }

    final accuracy = location.accuracyLabel;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          location.displayLabel,
          style: context.textStyles.label,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        // The coordinates are always shown alongside the address: they are what
        // the report is actually filed against, and they let the citizen
        // confirm the fix landed where they are standing.
        Text(
          accuracy != null
              ? '${location.coordinateLabel}  ·  $accuracy'
              : location.source.isManual
                  ? '${location.coordinateLabel}  ·  Set manually'
                  : location.coordinateLabel,
          style: context.textStyles.bodySmall,
        ),
        if (draft.locationCandidate != null)
          Text(
            'Check the pin below before using this location.',
            style: context.textStyles.bodySmall,
          ),
      ],
    );
  }
}

class _LocationConfirmation extends StatelessWidget {
  const _LocationConfirmation({
    required this.location,
    required this.isBusy,
  });

  final ReportLocation location;
  final bool isBusy;

  @override
  Widget build(BuildContext context) {
    final point = LatLng(location.latitude, location.longitude);
    final accuracy = location.accuracy;

    return Container(
      padding: const EdgeInsets.all(AppConstants.spacingSm),
      decoration: BoxDecoration(
        color: context.colors.inputFill,
        borderRadius: BorderRadius.circular(AppConstants.radiusMd),
        border: Border.all(color: context.colors.inputBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppConstants.radiusMd),
            child: SizedBox(
              height: 220,
              child: FlutterMap(
                key: ValueKey(
                  '${location.latitude}:${location.longitude}:${location.source.name}',
                ),
                options: MapOptions(
                  initialCenter: point,
                  initialZoom: 17,
                  minZoom: 4,
                  maxZoom: 19,
                  onTap: (_, selected) => context
                      .read<ReportDraftProvider>()
                      .adjustLocation(selected.latitude, selected.longitude),
                ),
                children: [
                  TileLayer(
                    urlTemplate:
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'com.example.civic_report',
                  ),
                  if (accuracy != null && accuracy > 0)
                    CircleLayer(
                      circles: [
                        CircleMarker(
                          point: point,
                          radius: accuracy,
                          useRadiusInMeter: true,
                          color: context.colors.primary.withValues(alpha: 0.12),
                          borderColor:
                              context.colors.primary.withValues(alpha: 0.55),
                          borderStrokeWidth: 1.5,
                        ),
                      ],
                    ),
                  MarkerLayer(
                    markers: [
                      Marker(
                        point: point,
                        width: 44,
                        height: 44,
                        alignment: Alignment.topCenter,
                        child: Icon(
                          Icons.location_pin,
                          size: 42,
                          color: context.colors.primary,
                        ),
                      ),
                    ],
                  ),
                  RichAttributionWidget(
                    showFlutterMapAttribution: false,
                    attributions: [
                      TextSourceAttribution(
                        'OpenStreetMap contributors',
                        onTap: () => launchUrl(
                          Uri.parse('https://openstreetmap.org/copyright'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppConstants.spacingSm),
          Text(
            location.source == ReportLocationSource.userAdjusted
                ? 'Pin adjusted manually. Tap the map to move it again.'
                : accuracy == null
                    ? 'Tap the map if the pin is not on the issue.'
                    : 'GPS uncertainty: about ${accuracy.round()} m. Tap the map to correct the pin.',
            style: context.textStyles.bodySmall,
          ),
          const SizedBox(height: AppConstants.spacingSm),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              TextButton(
                onPressed: isBusy
                    ? null
                    : () =>
                        context.read<ReportDraftProvider>().captureLocation(),
                child: const Text('Retake GPS'),
              ),
              TextButton(
                onPressed: isBusy ? null : () => _pickManually(context),
                child: const Text('Search instead'),
              ),
              FilledButton.icon(
                onPressed: isBusy
                    ? null
                    : () =>
                        context.read<ReportDraftProvider>().confirmLocation(),
                icon: isBusy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check_rounded),
                label: const Text('Use this location'),
              ),
            ],
          ),
        ],
      ),
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
      color: context.colors.inputFill,
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
            border: Border.all(color: context.colors.inputBorder),
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
      return Icon(
        Icons.my_location_rounded,
        size: 18,
        color: context.colors.primary,
      );
    }

    if (isResolved) {
      return const Icon(
        Icons.check_circle_outline_rounded,
        size: 18,
        color: AppColors.success,
      );
    }

    return Icon(
      Icons.location_on_outlined,
      size: 18,
      color: context.colors.inputIcon,
    );
  }
}
