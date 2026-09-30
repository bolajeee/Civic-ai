import 'dart:async';
import 'package:civic_report/features/report/models/report_summary.dart';
import 'package:civic_report/features/report/providers/report_summary_provider.dart';
import 'package:flutter_test/flutter_test.dart';

const counts = ReportSummary(
    total: 44, pending: 10, inProgress: 15, resolved: 17, rejected: 2);

void main() {
  test('parses the backend contract and rejects missing or invalid counts', () {
    final json = {
      'total': 44,
      'pending': 10,
      'inProgress': 15,
      'resolved': 17,
      'rejected': 2
    };
    final result = ReportSummary.fromJson(json);
    expect(result.total, 44);
    expect(result.inProgress, 15);
    expect(result.rejected, 2);
    expect(() => ReportSummary.fromJson({}), throwsFormatException);
    expect(() => ReportSummary.fromJson({...json, 'total': -1}),
        throwsFormatException);
  });

  test(
      'keeps previous counts on failure and supports retry and true zero counts',
      () async {
    var fail = false;
    var result = counts;
    final provider = ReportSummaryProvider(fetchSummary: () async {
      if (fail) throw Exception('offline');
      return result;
    })
      ..setCitizen('a');
    addTearDown(provider.dispose);
    expect(provider.summary, isNull);
    await provider.refresh();
    expect(provider.summary?.total, 44);
    fail = true;
    await provider.refresh();
    expect(provider.summary?.total, 44);
    expect(provider.errorMessage, contains('previous counts'));
    fail = false;
    result = const ReportSummary(
        total: 0, pending: 0, inProgress: 0, resolved: 0, rejected: 0);
    await provider.refresh();
    expect(provider.summary?.total, 0);
    expect(provider.errorMessage, isNull);
  });

  test('logout and account switches discard late responses', () async {
    final requests = <Completer<ReportSummary>>[];
    final provider = ReportSummaryProvider(fetchSummary: () {
      final request = Completer<ReportSummary>();
      requests.add(request);
      return request.future;
    })
      ..setCitizen('a');
    addTearDown(provider.dispose);
    final oldLoad = provider.refresh();
    provider.setCitizen(null);
    expect(provider.summary, isNull);
    provider.setCitizen('b');
    final newLoad = provider.refresh();
    requests.first.complete(counts);
    await oldLoad;
    expect(provider.summary, isNull);
    expect(provider.isLoading, isTrue);
    requests.last.complete(const ReportSummary(
        total: 1, pending: 1, inProgress: 0, resolved: 0, rejected: 0));
    await newLoad;
    expect(provider.summary?.total, 1);
  });

  test('post-submission refresh supersedes an older in-flight request',
      () async {
    final requests = <Completer<ReportSummary>>[];
    final provider = ReportSummaryProvider(fetchSummary: () {
      final request = Completer<ReportSummary>();
      requests.add(request);
      return request.future;
    })
      ..setCitizen('a');
    addTearDown(provider.dispose);
    final oldLoad = provider.refresh();
    await provider.refresh();
    expect(requests, hasLength(1));
    final newLoad = provider.refresh(force: true);
    requests.last.complete(counts);
    await newLoad;
    requests.first.complete(const ReportSummary(
        total: 0, pending: 0, inProgress: 0, resolved: 0, rejected: 0));
    await oldLoad;
    expect(provider.summary?.total, 44);
  });
}
