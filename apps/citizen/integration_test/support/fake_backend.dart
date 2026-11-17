import 'dart:convert';

import 'package:civic_report/features/sos/services/sos_text.dart'
    show normalizePhone;
import 'package:dio/dio.dart';

/// A recorded request, for asserting on what the app actually sent.
class RecordedRequest {
  RecordedRequest(this.method, this.path, this.options);

  final String method;
  final String path;
  final RequestOptions options;

  Map<String, dynamic> get json =>
      (options.data is Map) ? Map<String, dynamic>.from(options.data) : {};

  FormData? get form => options.data is FormData ? options.data : null;

  String? field(String name) {
    for (final entry in form?.fields ?? const <MapEntry<String, String>>[]) {
      if (entry.key == name) return entry.value;
    }
    return null;
  }

  int get fileCount => form?.files.length ?? 0;

  @override
  String toString() => '$method $path';
}

/// An in-memory stand-in for the CivicAI API, wired into the app's real Dio
/// client as an interceptor.
///
/// Every request the app makes is answered here, so the on-device tests drive
/// the real screens, providers and services without a server, a test account,
/// or creating real reports. Anything not stubbed answers 404 and is listed in
/// [unhandled], so a new endpoint cannot slip past the tests unnoticed.
class FakeBackend extends Interceptor {
  FakeBackend() {
    reset();
  }

  /// The password the fake account accepts. Made up per run rather than
  /// written into the source, so no credential-looking literal is committed.
  static final password = 'test-${DateTime.now().microsecondsSinceEpoch}';

  final List<RecordedRequest> requests = [];
  final List<String> unhandled = [];

  /// Keyed `METHOD /path`. The next matching request fails with this response.
  final Map<String, ({int status, Object body})> failNext = {};

  late Map<String, dynamic> user;
  late List<Map<String, dynamic>> reports;
  late List<Map<String, dynamic>> notifications;
  bool reportUpdatesEnabled = true;
  int _nextReport = 2001;

  static final categories = <Map<String, dynamic>>[
    {'id': 'cat-pothole', 'slug': 'POTHOLE', 'label': 'Pothole'},
    {'id': 'cat-flood', 'slug': 'FLOODING', 'label': 'Flooding'},
    {'id': 'cat-light', 'slug': 'STREETLIGHT', 'label': 'Streetlight'},
    {'id': 'cat-waste', 'slug': 'WASTE', 'label': 'Waste'},
    {'id': 'cat-water', 'slug': 'WATER_LEAK', 'label': 'Water Leak'},
    {'id': 'cat-other', 'slug': 'OTHER', 'label': 'Other'},
  ];

  /// What `GET /api/geo/search` returns, whatever the query — the shape the
  /// Geoapify proxy produces.
  static const placeResults = <Map<String, dynamic>>[
    {
      'id': 'place-computer-village',
      'label': 'Computer Village, Ikeja, Lagos',
      'address': 'Ikeja, Lagos',
      'latitude': 6.59650,
      'longitude': 3.34210,
      'category': 'commercial',
    },
    {
      'id': 'place-allen-roundabout',
      'label': 'Allen Avenue Roundabout, Ikeja, Lagos',
      'address': 'Ikeja, Lagos',
      'latitude': 6.60120,
      'longitude': 3.35460,
      'category': 'highway',
    },
  ];

  static Map<String, dynamic> category(String id) =>
      categories.firstWhere((c) => c['id'] == id);

  // --- SOS -------------------------------------------------------------------

  /// Keyed `METHOD /path`. The next matching request fails as if offline.
  final Set<String> failNetworkNext = {};
  late List<Map<String, dynamic>> sosContacts;
  Map<String, dynamic>? sosActiveAlert;
  bool sosSmsEnabled = true;
  static const sosTrackingUrl = 'https://civic.example/t/AbCdEfGhIjKlMnOpQrStUv';

  /// What `/location` answers with `stopUpdates`.
  bool sosStopUpdates = false;
  int _nextContact = 1;

  /// Nearest first, as the API returns them.
  static const sosFacilities = <Map<String, dynamic>>[
    {
      'id': 'osm-h1', 'name': 'Ikeja Medical Centre', 'kind': 'HOSPITAL',
      'agency': null, 'address': 'Allen Avenue, Ikeja', 'phones': ['08011112222'],
      'latitude': 6.6030, 'longitude': 3.3520, 'distanceMeters': 140, 'source': 'OSM',
    },
    {
      'id': 'osm-h2', 'name': 'Lagos State University Teaching Hospital', 'kind': 'HOSPITAL',
      'agency': null, 'address': 'Oba Akinjobi Way, Ikeja', 'phones': <String>[],
      'latitude': 6.5960, 'longitude': 3.3530, 'distanceMeters': 2400, 'source': 'OSM',
    },
  ];

  void reset() {
    requests.clear();
    unhandled.clear();
    failNext.clear();
    failNetworkNext.clear();
    sosContacts = [];
    sosActiveAlert = null;
    sosSmsEnabled = true;
    sosStopUpdates = false;
    _nextContact = 1;
    reportUpdatesEnabled = true;
    _nextReport = 2001;
    user = {
      'id': 'u-1',
      'public_id': 'CIT-0001',
      'email': 'ada.obi@example.com',
      'full_name': 'Ada Obi',
      'phone': null,
      'role': 'CITIZEN',
      'status': 'ACTIVE',
    };
    final now = DateTime.now().toUtc();
    String ago(Duration d) => now.subtract(d).toIso8601String();
    reports = [
      {
        'id': 'r-1003',
        'publicId': 'CR-1003',
        'status': 'PENDING',
        'category': category('cat-flood'),
        'photoCount': 1,
        'description': 'Blocked drain flooding the junction',
        'submittedAt': ago(const Duration(hours: 2)),
        'location': {
          'latitude': 6.4474,
          'longitude': 3.4723,
          'address': 'Admiralty Way, Lekki, Lagos',
          'source': 'DEVICE_GPS',
        },
      },
      {
        'id': 'r-1002',
        'publicId': 'CR-1002',
        'status': 'IN_PROGRESS',
        'category': category('cat-light'),
        'photoCount': 1,
        'description': 'Streetlight out on Bourdillon Road',
        'submittedAt': ago(const Duration(days: 2)),
        'location': {
          'latitude': 6.4531,
          'longitude': 3.4219,
          'address': 'Bourdillon Road, Ikoyi, Lagos',
          'source': 'DEVICE_GPS',
        },
      },
      {
        'id': 'r-1001',
        'publicId': 'CR-1001',
        'status': 'RESOLVED',
        'category': category('cat-pothole'),
        'photoCount': 2,
        'description': 'Deep pothole near the bus stop',
        'submittedAt': ago(const Duration(days: 9)),
        'priority': 'HIGH',
        'assignedAgency': 'Lagos State Public Works',
        'citizenReference': 'CIV-2026-1001',
        'location': {
          'latitude': 6.6018,
          'longitude': 3.3515,
          'address': 'Allen Avenue, Ikeja, Lagos',
          'source': 'DEVICE_GPS',
        },
        'aiClassification': {
          'status': 'completed',
          'category': category('cat-pothole'),
          'confidence': 0.91,
          'evidence': 'Road surface shows a deep, water-filled pothole.',
        },
        'events': [
          {'id': 'e-1', 'status': 'PENDING', 'occurredAt': ago(const Duration(days: 9))},
          {'id': 'e-2', 'status': 'IN_PROGRESS', 'occurredAt': ago(const Duration(days: 5))},
          {'id': 'e-3', 'status': 'RESOLVED', 'occurredAt': ago(const Duration(days: 1))},
        ],
      },
    ];
    notifications = [
      {
        'id': 'n-1',
        'title': 'Report CR-1001 resolved',
        'body': 'Your pothole report has been marked resolved.',
        'publicId': 'CR-1001',
        'reportStatus': 'RESOLVED',
        'createdAt': ago(const Duration(hours: 5)),
        'readAt': null,
        'data': {'route': '/report-details/CR-1001'},
      },
    ];
  }

  List<RecordedRequest> sent(String method, String path) => requests
      .where((r) => r.method == method && r.path == path)
      .toList(growable: false);

  // ---------------------------------------------------------------------------
  // Interceptor
  // ---------------------------------------------------------------------------

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final method = options.method.toUpperCase();
    final path = options.path;
    requests.add(RecordedRequest(method, path, options));

    if (failNetworkNext.remove('$method $path')) {
      handler.reject(
        DioException(
          requestOptions: options,
          type: DioExceptionType.connectionError,
          message: 'Simulated offline',
        ),
        true,
      );
      return;
    }

    final failure = failNext.remove('$method $path');
    if (failure != null) {
      _reject(handler, options, failure.status, failure.body);
      return;
    }

    final result = _route(method, path, options);
    if (result == null) {
      unhandled.add('$method $path');
      _reject(handler, options, 404, {'error': 'Not stubbed: $method $path'});
      return;
    }
    if (result.status >= 400) {
      _reject(handler, options, result.status, result.body);
      return;
    }
    handler.resolve(Response(
      requestOptions: options,
      statusCode: result.status,
      // Round-tripped so every nested map is Map<String, dynamic>, exactly as
      // Dio's JSON transformer would hand it to the app.
      data: jsonDecode(jsonEncode(result.body)),
    ));
  }

  void _reject(RequestInterceptorHandler handler, RequestOptions options,
      int status, Object body) {
    handler.reject(
      DioException(
        requestOptions: options,
        type: DioExceptionType.badResponse,
        response: Response(
          requestOptions: options,
          statusCode: status,
          data: jsonDecode(jsonEncode(body)),
        ),
      ),
      true,
    );
  }

  ({int status, Object body})? _route(
      String method, String path, RequestOptions o) {
    ({int status, Object body}) ok(Object body) => (status: 200, body: body);

    switch ('$method $path') {
      case 'POST /api/auth/login':
        final body = Map<String, dynamic>.from(o.data as Map);
        if (body['email'] != user['email'] || body['password'] != password) {
          return (status: 401, body: {'error': 'Invalid email or password'});
        }
        return ok(_authResponse());
      case 'GET /api/auth/me':
        return ok({'user': user});
      case 'PATCH /api/auth/me':
        final body = Map<String, dynamic>.from(o.data as Map);
        user = {...user, 'full_name': body['fullName'], 'phone': body['phone']};
        return ok({'user': user});
      case 'POST /api/auth/logout':
        return ok({'ok': true});
      case 'GET /api/reports/categories':
        return ok({'categories': categories});
      case 'GET /api/reports/summary':
        return ok(_summary());
      case 'GET /api/reports':
        return ok(_history(o.queryParameters));
      case 'POST /api/reports':
        return (status: 201, body: _submit(o.data as FormData));
      case 'GET /api/notifications/preferences':
        return ok({'reportUpdatesEnabled': reportUpdatesEnabled});
      case 'PATCH /api/notifications/preferences':
        reportUpdatesEnabled =
            (o.data as Map)['reportUpdatesEnabled'] as bool;
        return ok({'reportUpdatesEnabled': reportUpdatesEnabled});
      case 'GET /api/geo/search':
        return ok({'results': placeResults});
      case 'GET /api/sos/contacts':
        return ok({'contacts': sosContacts, 'max': 5, 'smsEnabled': sosSmsEnabled});
      case 'POST /api/sos/contacts':
        if (sosContacts.length >= 5) {
          return (status: 409, body: {'error': 'You can add up to 5 trusted contacts'});
        }
        final body = Map<String, dynamic>.from(o.data as Map);
        final contact = {
          'id': 'tc-${_nextContact++}',
          'name': body['name'],
          'phone': normalizePhone(body['phone'] as String),
          'relationship': body['relationship'],
        };
        sosContacts.add(contact);
        return (status: 201, body: {'contact': contact});
      case 'GET /api/sos/nearby':
        return ok({
          'facilities': sosFacilities,
          'hotlines': [
            {'id': 'ng-112', 'label': 'National Emergency', 'number': '112',
              'description': 'Toll-free from any network.', 'sourceUrl': 'https://www.ncc.gov.ng/'},
          ],
          'partial': false,
        });
      case 'GET /api/sos/alerts/active':
        return ok({'alert': sosActiveAlert});
      case 'POST /api/sos/alerts':
        final body = Map<String, dynamic>.from(o.data as Map);
        sosActiveAlert = {
          'publicId': 'SOS-1000',
          'type': body['type'],
          'status': 'ACTIVE',
          'latitude': body['lat'],
          'longitude': body['lon'],
          'accuracy': body['accuracy'],
          'updateIntervalMinutes': body['updateIntervalMinutes'],
          'lastPingedAt': body['lat'] == null ? null : DateTime.now().toUtc().toIso8601String(),
          'pingCount': 0,
          'updatesStoppedAt': null,
          'createdAt': DateTime.now().toUtc().toIso8601String(),
          'resolvedAt': null,
          'trackingUrl': sosTrackingUrl,
        };
        return (status: 201, body: {
          'alert': sosActiveAlert!,
          'contactsQueued': sosSmsEnabled ? sosContacts.length : 0,
          'smsEnabled': sosSmsEnabled,
          'message': 'SOS from Ada Obi via CivicAI: ${body['type']} emergency. '
              'Live location: $sosTrackingUrl',
        });
      case 'POST /api/sos/alerts/SOS-1000/location':
        return ok({
          'pinged': true,
          'stopUpdates': sosStopUpdates,
          'nextUpdateAfter': sosStopUpdates
              ? null
              : DateTime.now().toUtc().add(const Duration(minutes: 15)).toIso8601String(),
        });
      case 'POST /api/sos/alerts/SOS-1000/safe':
        final resolved = {...?sosActiveAlert, 'status': 'RESOLVED'};
        sosActiveAlert = null;
        return ok({
          'alert': resolved,
          'smsEnabled': sosSmsEnabled,
          'message': 'Ada Obi has marked themselves safe via CivicAI. No further SOS updates will be sent.',
        });
      case 'GET /api/notifications/':
        return ok({'notifications': notifications});
    }

    final contact = RegExp(r'^/api/sos/contacts/([^/]+)$').firstMatch(path);
    if (contact != null && (method == 'PATCH' || method == 'DELETE')) {
      final index = sosContacts.indexWhere((c) => c['id'] == contact.group(1));
      if (index < 0) return (status: 404, body: {'error': 'Contact not found'});
      if (method == 'DELETE') {
        sosContacts.removeAt(index);
        return (status: 204, body: <String, dynamic>{});
      }
      final body = Map<String, dynamic>.from(o.data as Map);
      final relationship = body['relationship'] as String?;
      sosContacts[index] = {
        ...sosContacts[index],
        'name': body['name'],
        'phone': normalizePhone(body['phone'] as String),
        'relationship': (relationship == null || relationship.isEmpty) ? null : relationship,
      };
      return ok({'contact': sosContacts[index]});
    }

    final read = RegExp(r'^/api/notifications/([^/]+)/read$').firstMatch(path);
    if (method == 'POST' && read != null) {
      for (final n in notifications) {
        if (n['id'] == read.group(1)) {
          n['readAt'] = DateTime.now().toUtc().toIso8601String();
        }
      }
      return ok({'ok': true});
    }

    final detail = RegExp(r'^/api/reports/([^/]+)$').firstMatch(path);
    if (method == 'GET' && detail != null) {
      final id = Uri.decodeComponent(detail.group(1)!);
      for (final r in reports) {
        if (r['publicId'] == id) return ok({'report': r});
      }
      return (status: 404, body: {'error': 'Report not found'});
    }

    return null;
  }

  Map<String, dynamic> _authResponse() => {
        'accessToken': 'fake-access-token',
        'refreshToken': 'fake-refresh-token',
        'user': user,
      };

  Map<String, dynamic> _summary() {
    int count(String status) =>
        reports.where((r) => r['status'] == status).length;
    return {
      'total': reports.length,
      'pending': count('PENDING'),
      'inProgress': count('IN_PROGRESS'),
      'resolved': count('RESOLVED'),
      'rejected': count('REJECTED'),
      'impactScore': 42,
    };
  }

  Map<String, dynamic> _history(Map<String, dynamic> query) {
    final status = query['status'] as String?;
    final q = (query['q'] as String?)?.toLowerCase();
    final limit = query['limit'] as int? ?? 20;
    final offset = query['offset'] as int? ?? 0;

    final matching = reports.where((r) {
      if (status != null && r['status'] != status) return false;
      if (q == null) return true;
      final haystack = [
        r['description'],
        (r['category'] as Map)['label'],
        (r['location'] as Map?)?['address'],
      ].whereType<String>().join(' ').toLowerCase();
      return haystack.contains(q);
    }).toList();

    final page = matching.skip(offset).take(limit).toList();
    return {
      'reports': page,
      'pagination': {'hasMore': offset + page.length < matching.length},
    };
  }

  Map<String, dynamic> _submit(FormData form) {
    final fields = {for (final f in form.fields) f.key: f.value};
    final publicId = 'CR-${_nextReport++}';
    final submittedAt = DateTime.now().toUtc().toIso8601String();
    final lat = double.tryParse(fields['latitude'] ?? '');
    final lng = double.tryParse(fields['longitude'] ?? '');

    reports.insert(0, {
      'id': 'r-$publicId',
      'publicId': publicId,
      'status': 'PENDING',
      'category': category(fields['categoryId']!),
      'photoCount': form.files.length,
      'description': fields['description'],
      'submittedAt': submittedAt,
      if (lat != null && lng != null)
        'location': {
          'latitude': lat,
          'longitude': lng,
          'address': fields['address'],
          'source': 'DEVICE_GPS',
        },
      'events': [
        {'id': 'e-$publicId', 'status': 'PENDING', 'occurredAt': submittedAt},
      ],
    });

    return {
      'report': {
        'id': 'r-$publicId',
        'publicId': publicId,
        'status': 'PENDING',
        'submittedAt': submittedAt,
      },
    };
  }
}
