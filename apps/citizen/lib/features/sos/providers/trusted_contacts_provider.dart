import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/sos_models.dart';
import '../services/sos_service.dart';

/// The citizen's trusted contacts.
///
/// The list is cached on the device per account, so the offline SOS fallback
/// still knows who to text when the API cannot be reached.
class TrustedContactsProvider extends ChangeNotifier {
  TrustedContactsProvider({SosService? service})
      : _service = service ?? SosService.instance;

  final SosService _service;

  static const int maxContacts = 5;

  String? _citizenId;
  List<TrustedContact> _contacts = const [];
  bool _isLoading = false;
  bool _hasLoaded = false;
  bool _smsEnabled = true;
  String? _errorMessage;

  List<TrustedContact> get contacts => List.unmodifiable(_contacts);
  bool get isLoading => _isLoading;
  bool get hasLoaded => _hasLoaded;
  String? get errorMessage => _errorMessage;
  bool get canAddMore => _contacts.length < maxContacts;

  /// Whether the server texts contacts itself (from the last load). False:
  /// alerts go out through the citizen's own messages app.
  bool get smsEnabled => _smsEnabled;

  String get _cacheKey => 'sos_contacts_$_citizenId';

  void setCitizen(String? id) {
    if (_citizenId == id) return;
    _citizenId = id;
    _contacts = const [];
    _hasLoaded = false;
    _errorMessage = null;
    notifyListeners();
    if (id != null) _restoreCache();
  }

  Future<void> _restoreCache() async {
    final id = _citizenId;
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cacheKey);
      if (raw == null || id != _citizenId || _hasLoaded) return;
      _contacts = (jsonDecode(raw) as List<dynamic>)
          .map((c) => TrustedContact.fromJson(Map<String, dynamic>.from(c)))
          .toList(growable: false);
      notifyListeners();
    } catch (_) {
      // A corrupt cache is only a missed convenience; the API is the source.
    }
  }

  Future<void> _saveCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
          _cacheKey, jsonEncode(_contacts.map((c) => c.toJson()).toList()));
    } catch (_) {}
  }

  Future<void> load() async {
    if (_citizenId == null || _isLoading) return;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final result = await _service.fetchContacts();
      _contacts = result.contacts;
      _smsEnabled = result.smsEnabled;
      _hasLoaded = true;
      await _saveCache();
    } on SosException catch (e) {
      // Keep the cached list on screen; it is still what an alert would use.
      _errorMessage = e.message;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// Adds a contact. Returns null on success, or the reason it failed.
  Future<String?> add(
          {required String name,
          required String phone,
          String? relationship}) =>
      _mutate(() async {
        final contact = await _service.addContact(
            name: name, phone: phone, relationship: relationship);
        _contacts = [..._contacts, contact];
      });

  Future<String?> update(TrustedContact contact,
          {required String name,
          required String phone,
          String? relationship}) =>
      _mutate(() async {
        final updated = await _service.updateContact(contact.id,
            name: name, phone: phone, relationship: relationship);
        _contacts = [
          for (final c in _contacts) c.id == contact.id ? updated : c,
        ];
      });

  Future<String?> remove(TrustedContact contact) => _mutate(() async {
        await _service.deleteContact(contact.id);
        _contacts = _contacts.where((c) => c.id != contact.id).toList();
      });

  Future<String?> _mutate(Future<void> Function() change) async {
    try {
      await change();
      await _saveCache();
      notifyListeners();
      return null;
    } on SosException catch (e) {
      return e.message;
    }
  }
}
