import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:geocoding_platform_interface/geocoding_platform_interface.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:image_picker_platform_interface/image_picker_platform_interface.dart';
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher_platform_interface/link.dart';
import 'package:url_launcher_platform_interface/url_launcher_platform_interface.dart';

/// Records every URL the app opens — calls, texts, directions — instead of
/// leaving the app for the dialer or messages, which would end the test.
class FakeUrlLauncher extends UrlLauncherPlatform {
  final List<String> launched = [];

  @override
  LinkDelegate? get linkDelegate => null;

  @override
  Future<bool> canLaunch(String url) async => true;

  @override
  Future<bool> launchUrl(String url, LaunchOptions options) async {
    launched.add(url);
    return true;
  }

  @override
  Future<bool> launch(
    String url, {
    required bool useSafariVC,
    required bool useWebView,
    required bool enableJavaScript,
    required bool enableDomStorage,
    required bool universalLinksOnly,
    required Map<String, String> headers,
    String? webOnlyWindowName,
  }) async {
    launched.add(url);
    return true;
  }
}

/// Stands in for the system photo picker, which an integration test cannot
/// drive. Returns a real image file so the app's decode, thumbnail and
/// multipart upload paths all run for real.
class FakeImagePicker extends ImagePickerPlatform {
  int calls = 0;
  ImageSource? lastSource;

  /// When false the picker behaves as if the citizen backed out.
  bool returnPhoto = true;

  // A 1x1 PNG.
  static final _png = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  );

  @override
  Future<XFile?> getImageFromSource({
    required ImageSource source,
    ImagePickerOptions options = const ImagePickerOptions(),
  }) async {
    calls++;
    lastSource = source;
    if (!returnPhoto) return null;
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/test_evidence_$calls.png');
    await file.writeAsBytes(_png, flush: true);
    return XFile(file.path, name: 'test_evidence_$calls.png');
  }
}

/// A GPS that answers immediately, at a fixed point in Ikeja, Lagos.
class FakeGeolocator extends GeolocatorPlatform {
  static const latitude = 6.60180;
  static const longitude = 3.35150;

  bool serviceEnabled = true;
  LocationPermission permission = LocationPermission.whileInUse;

  @override
  Future<bool> isLocationServiceEnabled() async => serviceEnabled;

  @override
  Future<LocationPermission> checkPermission() async => permission;

  @override
  Future<LocationPermission> requestPermission() async => permission;

  @override
  Future<Position?> getLastKnownPosition({
    bool forceLocationManager = false,
  }) async =>
      null;

  @override
  Stream<Position> getPositionStream({LocationSettings? locationSettings}) =>
      Stream.fromIterable([_position(15), _position(8)]);

  @override
  Future<bool> openAppSettings() async => true;

  @override
  Future<bool> openLocationSettings() async => true;

  Position _position(double accuracy) => Position(
        latitude: latitude,
        longitude: longitude,
        timestamp: DateTime.now(),
        accuracy: accuracy,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      );
}

/// A reverse geocoder with one fixed answer, so the address is deterministic.
class FakeGeocoding extends GeocodingPlatform {
  static const address = '12 Allen Avenue, Ikeja, Lagos';

  @override
  Future<List<Placemark>> placemarkFromCoordinates(
    double latitude,
    double longitude,
  ) async =>
      const [
        Placemark(
          street: '12 Allen Avenue',
          locality: 'Ikeja',
          administrativeArea: 'Lagos',
        ),
      ];
}
