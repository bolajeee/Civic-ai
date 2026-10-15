import 'package:flutter/foundation.dart';

import '../models/submitted_report.dart';
import '../services/report_service.dart';

typedef HistoryPageFetcher = Future<ReportHistoryPage> Function({
  int limit,
  int offset,
  ReportStatus? status,
  String? query,
});

/// Owner-scoped recent reports, paginated history, and full-dataset Home search.
class ReportHistoryProvider extends ChangeNotifier {
  ReportHistoryProvider({HistoryPageFetcher? fetchPage})
      : _fetchPage = fetchPage ?? ReportService.instance.fetchHistory;

  static const pageSize = 20;
  final HistoryPageFetcher _fetchPage;

  String? _citizenId;
  List<SubmittedReport> _reports = const [];
  List<SubmittedReport> _recentReports = const [];
  List<SubmittedReport> _searchResults = const [];
  ReportStatus? _activeStatus;
  bool _isLoading = false;
  bool _isLoadingMore = false;
  bool _isSearching = false;
  bool _hasLoaded = false;
  bool _hasRecentLoaded = false;
  bool _hasMore = false;
  String? _errorMessage;
  String? _searchError;
  int _historyGeneration = 0;
  int _searchGeneration = 0;
  int _recentGeneration = 0;

  List<SubmittedReport> get reports => List.unmodifiable(_reports);
  List<SubmittedReport> get recentReports => List.unmodifiable(_recentReports);
  List<SubmittedReport> get searchResults => List.unmodifiable(_searchResults);
  ReportStatus? get activeStatus => _activeStatus;
  bool get isLoading => _isLoading;
  bool get isLoadingMore => _isLoadingMore;
  bool get isSearching => _isSearching;
  bool get hasLoaded => _hasLoaded;
  bool get hasRecentLoaded => _hasRecentLoaded;
  bool get hasMore => _hasMore;
  String? get errorMessage => _errorMessage;
  String? get searchError => _searchError;
  bool get isEmpty => _hasLoaded && _errorMessage == null && _reports.isEmpty;

  void setCitizen(String? id) {
    if (_citizenId == id) return;
    _citizenId = id;
    _historyGeneration++;
    _searchGeneration++;
    _recentGeneration++;
    _reports = const [];
    _recentReports = const [];
    _searchResults = const [];
    _activeStatus = null;
    _isLoading = false;
    _isLoadingMore = false;
    _isSearching = false;
    _hasLoaded = false;
    _hasRecentLoaded = false;
    _hasMore = false;
    _errorMessage = null;
    _searchError = null;
    notifyListeners();
  }

  SubmittedReport? byPublicId(String id) {
    for (final collection in [_reports, _recentReports, _searchResults]) {
      for (final report in collection) {
        if (report.publicId == id) return report;
      }
    }
    return null;
  }

  /// Loads the first unfiltered page used by Home, Profile, and History.
  Future<void> load({bool showSpinner = true}) async {
    _activeStatus = null;
    await _loadFirst(showSpinner: showSpinner, updateRecent: true);
  }

  /// Switches History to an exact server-side status filter.
  Future<void> setStatus(ReportStatus? status) async {
    if (status == ReportStatus.unknown) status = null;
    if (_hasLoaded && _activeStatus == status) return;
    _activeStatus = status;
    _reports = const [];
    _hasLoaded = false;
    _hasMore = false;
    await _loadFirst(showSpinner: true, updateRecent: status == null);
  }

  Future<void> _loadFirst({
    required bool showSpinner,
    required bool updateRecent,
  }) async {
    if (_citizenId == null) return;
    final generation = ++_historyGeneration;
    final recentGeneration =
        updateRecent ? ++_recentGeneration : _recentGeneration;
    _isLoading = true;
    _isLoadingMore = false;
    _errorMessage = null;
    if (showSpinner) notifyListeners();

    try {
      final page = await _fetchPage(
        limit: pageSize,
        offset: 0,
        status: _activeStatus,
        query: null,
      );
      if (generation != _historyGeneration) return;
      _reports = page.reports;
      _hasMore = page.hasMore;
      if (updateRecent && recentGeneration == _recentGeneration) {
        _recentReports = page.reports;
        _hasRecentLoaded = true;
      }
    } on ReportSubmissionException catch (error) {
      if (generation == _historyGeneration) _errorMessage = error.message;
    } catch (_) {
      if (generation == _historyGeneration) {
        _errorMessage = 'Could not load your reports. Please try again.';
      }
    } finally {
      if (generation == _historyGeneration) {
        _isLoading = false;
        _hasLoaded = true;
        notifyListeners();
      }
    }
  }

  Future<void> loadMore() async {
    if (_citizenId == null || _isLoading || _isLoadingMore || !_hasMore) return;
    final generation = _historyGeneration;
    _isLoadingMore = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final page = await _fetchPage(
        limit: pageSize,
        offset: _reports.length,
        status: _activeStatus,
        query: null,
      );
      if (generation != _historyGeneration) return;
      final known = _reports.map((report) => report.id).toSet();
      _reports = [
        ..._reports,
        ...page.reports.where((report) => known.add(report.id)),
      ];
      _hasMore = page.hasMore;
      if (_activeStatus == null) {
        _recentReports = _reports.take(pageSize).toList(growable: false);
        _hasRecentLoaded = true;
      }
    } catch (_) {
      if (generation == _historyGeneration) {
        _errorMessage = 'Could not load more reports. Please try again.';
      }
    } finally {
      if (generation == _historyGeneration) {
        _isLoadingMore = false;
        notifyListeners();
      }
    }
  }

  Future<void> refresh() => _loadFirst(
        showSpinner: false,
        updateRecent: _activeStatus == null,
      );

  Future<void> refreshRecent() async {
    if (_activeStatus == null) return refresh();
    if (_citizenId == null) return;
    final owner = _citizenId;
    final generation = ++_recentGeneration;
    try {
      final page = await _fetchPage(
        limit: pageSize,
        offset: 0,
        status: null,
        query: null,
      );
      if (owner == _citizenId && generation == _recentGeneration) {
        _recentReports = page.reports;
        _hasRecentLoaded = true;
        notifyListeners();
      }
    } catch (_) {
      // A failed background refresh keeps the last known Home snapshot.
    }
  }

  /// Searches the complete owner-scoped dataset; Home displays its first 3 hits.
  void clearSearch() {
    _searchGeneration++;
    _searchResults = const [];
    _searchError = null;
    _isSearching = false;
    notifyListeners();
  }

  Future<void> search(String value) async {
    final query = value.trim();
    final generation = ++_searchGeneration;
    if (query.isEmpty || _citizenId == null) {
      _searchResults = const [];
      _searchError = null;
      _isSearching = false;
      notifyListeners();
      return;
    }
    _isSearching = true;
    _searchError = null;
    notifyListeners();
    try {
      final page = await _fetchPage(
        limit: 3,
        offset: 0,
        status: null,
        query: query,
      );
      if (generation != _searchGeneration) return;
      _searchResults = page.reports;
    } catch (_) {
      if (generation == _searchGeneration) {
        _searchError = 'Could not search your reports. Please try again.';
      }
    } finally {
      if (generation == _searchGeneration) {
        _isSearching = false;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _historyGeneration++;
    _searchGeneration++;
    _recentGeneration++;
    super.dispose();
  }
}
