import 'package:flutter/foundation.dart';
import '../models/report_summary.dart';
import '../services/report_service.dart';

/// Aggregate counts are independent of the loaded history page.
class ReportSummaryProvider extends ChangeNotifier {
  ReportSummaryProvider({Future<ReportSummary> Function()? fetchSummary})
      : _fetchSummary = fetchSummary ?? ReportService.instance.fetchSummary;

  final Future<ReportSummary> Function() _fetchSummary;
  ReportSummary? _summary;
  String? _citizenId;
  String? _errorMessage;
  bool _isLoading = false;
  int _generation = 0;

  ReportSummary? get summary => _summary;
  String? get errorMessage => _errorMessage;
  bool get isLoading => _isLoading;

  void setCitizen(String? id) {
    if (_citizenId == id) return;
    _citizenId = id;
    _generation++;
    _summary = null;
    _errorMessage = null;
    _isLoading = false;
    notifyListeners();
  }

  /// A forced refresh supersedes a request started before report submission.
  Future<void> refresh({bool force = false}) async {
    if (_citizenId == null || (_isLoading && !force)) return;
    final generation = ++_generation;
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();
    try {
      final result = await _fetchSummary();
      if (generation == _generation) _summary = result;
    } catch (_) {
      if (generation == _generation) {
        _errorMessage = _summary == null
            ? 'Could not load report counts.'
            : 'Could not refresh report counts. Showing previous counts.';
      }
    } finally {
      if (generation == _generation) {
        _isLoading = false;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }
}
