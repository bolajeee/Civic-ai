import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_colors_extension.dart';
import '../models/location_suggestion.dart';
import '../models/report_location.dart';
import '../services/location_search_service.dart';

/// Lets the citizen set a report's location by hand: search for a street or
/// landmark, or tap the map to drop a pin.
///
/// For when GPS is denied, unavailable, or simply wrong — a citizen reporting
/// a pothole they passed earlier is not standing on it. Pops with the chosen
/// [ReportLocation], or null if the citizen backs out.
class LocationPickerScreen extends StatefulWidget {
  const LocationPickerScreen({super.key, this.initial});

  /// Where the map opens, and what search results are ranked near. Usually
  /// the current GPS fix or previously chosen location.
  final ReportLocation? initial;

  static const searchFieldKey = ValueKey('location-search');

  /// Roughly the middle of Nigeria, zoomed out to show the whole country,
  /// for when there is no location to start from.
  static const _nigeria = LatLng(9.0820, 8.6753);

  /// Opens the picker and returns the chosen location.
  static Future<ReportLocation?> open(
    BuildContext context, {
    ReportLocation? initial,
  }) =>
      Navigator.of(context).push<ReportLocation>(
        MaterialPageRoute(
          builder: (_) => LocationPickerScreen(initial: initial),
        ),
      );

  @override
  State<LocationPickerScreen> createState() => _LocationPickerScreenState();
}

class _LocationPickerScreenState extends State<LocationPickerScreen> {
  final _search = LocationSearchService.instance;
  final _query = TextEditingController();
  final _map = MapController();
  Timer? _debounce;

  /// Incremented per search so a slow response cannot replace a newer one.
  int _searchSeq = 0;
  bool _searching = false;
  String? _searchError;
  List<LocationSuggestion>? _results;

  ReportLocation? _selected;

  @override
  void initState() {
    super.initState();
    _selected = widget.initial;
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    final query = value.trim();
    if (query.length < LocationSearchService.minQueryLength) {
      _searchSeq++;
      setState(() {
        _searching = false;
        _searchError = null;
        _results = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), () => _run(query));
  }

  Future<void> _run(String query) async {
    final seq = ++_searchSeq;
    final near = widget.initial;
    setState(() {
      _searching = true;
      _searchError = null;
    });
    try {
      final results = await _search.search(
        query,
        latitude: near?.latitude,
        longitude: near?.longitude,
      );
      if (!mounted || seq != _searchSeq) return;
      setState(() => _results = results);
    } on LocationSearchException catch (e) {
      if (!mounted || seq != _searchSeq) return;
      setState(() {
        _results = null;
        _searchError = e.message;
      });
    } finally {
      if (mounted && seq == _searchSeq) setState(() => _searching = false);
    }
  }

  void _choose(LocationSuggestion suggestion) {
    FocusManager.instance.primaryFocus?.unfocus();
    final location = ReportLocation(
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      address: suggestion.label,
      source: ReportLocationSource.userSelected,
      capturedAt: DateTime.now(),
    );
    _searchSeq++;
    setState(() {
      _selected = location;
      _results = null;
      _searching = false;
      _searchError = null;
    });
    _map.move(LatLng(location.latitude, location.longitude), 17);
  }

  void _dropPin(LatLng point) {
    FocusManager.instance.primaryFocus?.unfocus();
    _searchSeq++;
    setState(() {
      // No address yet: the report form reverse-geocodes it once confirmed.
      _selected = ReportLocation(
        latitude: point.latitude,
        longitude: point.longitude,
        source: ReportLocationSource.userSelected,
        capturedAt: DateTime.now(),
      );
      _results = null;
      _searching = false;
      _searchError = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final initial = widget.initial;
    final selected = _selected;
    final pin = selected == null
        ? null
        : LatLng(selected.latitude, selected.longitude);

    return Scaffold(
      appBar: AppBar(title: const Text('Choose location')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppConstants.spacingMd,
              AppConstants.spacingSm,
              AppConstants.spacingMd,
              AppConstants.spacingSm,
            ),
            child: TextField(
              key: LocationPickerScreen.searchFieldKey,
              controller: _query,
              onChanged: _onQueryChanged,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search street or landmark',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _searching
                    ? const Padding(
                        padding: EdgeInsets.all(14),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : null,
              ),
            ),
          ),
          Expanded(
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _map,
                  options: MapOptions(
                    initialCenter: initial == null
                        ? LocationPickerScreen._nigeria
                        : LatLng(initial.latitude, initial.longitude),
                    initialZoom: initial == null ? 6 : 17,
                    minZoom: 4,
                    maxZoom: 19,
                    onTap: (_, point) => _dropPin(point),
                  ),
                  children: [
                    TileLayer(
                      urlTemplate:
                          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.example.civic_report',
                    ),
                    if (pin != null)
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: pin,
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
                if (_results != null || _searchError != null)
                  Positioned(
                    left: AppConstants.spacingMd,
                    right: AppConstants.spacingMd,
                    top: 0,
                    child: _SearchResults(
                      results: _results ?? const [],
                      error: _searchError,
                      onSelected: _choose,
                    ),
                  ),
              ],
            ),
          ),
          _SelectionPanel(
            selected: selected,
            onConfirm: selected == null
                ? null
                : () => Navigator.of(context).pop(selected),
          ),
        ],
      ),
    );
  }
}

class _SearchResults extends StatelessWidget {
  const _SearchResults({
    required this.results,
    required this.error,
    required this.onSelected,
  });

  final List<LocationSuggestion> results;
  final String? error;
  final ValueChanged<LocationSuggestion> onSelected;

  @override
  Widget build(BuildContext context) {
    final message = error ??
        (results.isEmpty
            ? 'No places found. Try another name, or tap the map.'
            : null);

    return Material(
      elevation: 4,
      color: context.colors.surface,
      borderRadius: BorderRadius.circular(AppConstants.radiusMd),
      clipBehavior: Clip.antiAlias,
      child: message != null
          ? Padding(
              padding: const EdgeInsets.all(AppConstants.spacingMd),
              child: Text(message, style: context.textStyles.bodySmall),
            )
          : ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 280),
              child: ListView.separated(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: results.length,
                separatorBuilder: (_, __) =>
                    Divider(height: 1, color: context.colors.divider),
                itemBuilder: (context, index) {
                  final result = results[index];
                  final subtitle = result.subtitle;
                  return ListTile(
                    leading: Icon(Icons.place_outlined,
                        color: context.colors.inputIcon),
                    title: Text(result.label,
                        style: context.textStyles.label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis),
                    subtitle: subtitle == null
                        ? null
                        : Text(subtitle, style: context.textStyles.bodySmall),
                    onTap: () => onSelected(result),
                  );
                },
              ),
            ),
    );
  }
}

class _SelectionPanel extends StatelessWidget {
  const _SelectionPanel({required this.selected, required this.onConfirm});

  final ReportLocation? selected;
  final VoidCallback? onConfirm;

  @override
  Widget build(BuildContext context) {
    final location = selected;
    final address = location?.address;

    return Material(
      color: context.colors.surface,
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(AppConstants.spacingMd),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (location == null)
                Text(
                  'Search for a street or landmark, or tap the map to drop a pin on the issue.',
                  style: context.textStyles.bodyMedium,
                )
              else ...[
                Text(
                  address == null || address.isEmpty
                      ? 'Pin dropped on the map'
                      : address,
                  style: context.textStyles.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${location.coordinateLabel}  ·  Tap the map to move the pin.',
                  style: context.textStyles.bodySmall,
                ),
              ],
              const SizedBox(height: AppConstants.spacingSm),
              FilledButton.icon(
                onPressed: onConfirm,
                icon: const Icon(Icons.check_rounded),
                label: const Text('Use this location'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
