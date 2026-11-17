import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

import '../models/sos_models.dart';

/// Client-side copies of the API's phone and SMS rules, for instant form
/// validation and for the offline fallback — when the API is unreachable the
/// phone's own SMS app sends the alert, so the app must build the text itself.

/// Normalises a phone number to E.164, treating bare numbers as Nigerian.
/// Mirrors `normalizePhone` in services/api/src/lib/sos-messages.ts.
String? normalizePhone(String input) {
  final compact = input.trim().replaceAll(RegExp(r'[\s\-().]'), '');
  if (RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(compact)) {
    if (compact.startsWith('+234') &&
        !RegExp(r'^\+234[789]\d{9}$').hasMatch(compact)) {
      return null;
    }
    return compact;
  }
  if (RegExp(r'^234[789]\d{9}$').hasMatch(compact)) return '+$compact';
  if (RegExp(r'^0[789]\d{9}$').hasMatch(compact)) {
    return '+234${compact.substring(1)}';
  }
  if (RegExp(r'^[789]\d{9}$').hasMatch(compact)) return '+234$compact';
  return null;
}

/// The alert text sent through the phone's SMS app when the server's own text
/// is not at hand (offline, or re-sending a restored alert). Shorter than the
/// server's version: there is no callback number to add (the SMS comes from
/// the citizen's own phone).
String offlineAlertText({
  required String? name,
  required EmergencyType type,
  double? latitude,
  double? longitude,
  String? trackingUrl,
}) {
  final who = (name == null || name.trim().isEmpty) ? 'I' : name.trim();
  final location = latitude != null && longitude != null
      ? 'My location: https://maps.google.com/?q=${latitude.toStringAsFixed(5)},${longitude.toStringAsFixed(5)}'
      : 'My location is not available.';
  final live =
      trackingUrl == null ? '' : ' Follow my live location: $trackingUrl';
  return 'SOS: $who need${who == 'I' ? '' : 's'} help - '
      '${type.label.toUpperCase()} emergency. $location '
      'Please call me or 112.$live (Sent via CivicAI)';
}

/// An `sms:` link to one number, with [body] filled in.
///
/// Always one recipient: a text addressed to several people becomes a group
/// MMS, which needs mobile data and MMS settings and is often blocked or
/// silently fails. Contacts are texted one after another instead.
///
/// iOS reads the body after `&`; Android after `?`.
Uri smsUri(String phone, String body, {bool? ios}) {
  final isIos = ios ?? (!kIsWeb && Platform.isIOS);
  final encodedBody = Uri.encodeComponent(body);
  return Uri.parse('sms:$phone${isIos ? '&' : '?'}body=$encodedBody');
}

/// The name contacts see: the full name, or one built from the email
/// ("ada.obi@x.com" -> "Ada Obi"). Mirrors `displayName` in
/// services/api/src/lib/sos-messages.ts.
String? citizenDisplayName(String? fullName, String? email) {
  final name = fullName?.trim() ?? '';
  if (name.isNotEmpty) return name;
  final local = (email ?? '').split('@').first;
  final words = local
      .split(RegExp(r'[._\-+]'))
      .map((word) => word.replaceAll(RegExp(r'\d+'), ''))
      .where((word) => word.isNotEmpty)
      .map((word) =>
          '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}');
  return words.isEmpty ? null : words.join(' ');
}

Uri telUri(String number) =>
    Uri(scheme: 'tel', path: number.replaceAll(RegExp(r'[^\d+]'), ''));

Uri directionsUri(double latitude, double longitude) => Uri.parse(
      'https://www.google.com/maps/dir/?api=1&destination=$latitude,$longitude',
    );
