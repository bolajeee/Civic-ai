import 'dart:async';

import 'package:civic_report/features/report/models/report_category.dart';
import 'package:civic_report/features/report/models/submitted_report.dart';
import 'package:civic_report/features/report/providers/report_history_provider.dart';
import 'package:civic_report/features/report/services/report_service.dart';
import 'package:flutter_test/flutter_test.dart';

SubmittedReport report(int value,
    {ReportStatus status = ReportStatus.pending}) {
  return SubmittedReport(
    id: 'id-$value',
    publicId: 'CR-$value',
    status: status,
    category: const ReportCategory(
      id: 'category',
      slug: 'POTHOLE',
      label: 'Pothole',
    ),
    photoCount: 0,
  );
}

void main() {
  test('loads additional pages and sends status filters to the server',
      () async {
    final calls = <({int offset, ReportStatus? status, String? query})>[];
    final provider = ReportHistoryProvider(fetchPage: ({
      int limit = 20,
      int offset = 0,
      ReportStatus? status,
      String? query,
    }) async {
      calls.add((offset: offset, status: status, query: query));
      if (status == ReportStatus.resolved) {
        return ReportHistoryPage(
          reports: [report(100, status: ReportStatus.resolved)],
          hasMore: false,
        );
      }
      final count = offset == 0 ? 20 : 5;
      return ReportHistoryPage(
        reports: List.generate(count, (index) => report(offset + index)),
        hasMore: offset == 0,
      );
    });
    addTearDown(provider.dispose);
    provider.setCitizen('citizen-a');

    await provider.load();
    expect(provider.reports, hasLength(20));
    expect(provider.hasMore, isTrue);
    await provider.loadMore();
    expect(provider.reports, hasLength(25));
    expect(calls[1].offset, 20);

    await provider.setStatus(ReportStatus.resolved);
    expect(provider.reports.single.status, ReportStatus.resolved);
    expect(calls.last.status, ReportStatus.resolved);
  });

  test('Home search queries the full dataset independently of recent reports',
      () async {
    final provider = ReportHistoryProvider(fetchPage: ({
      int limit = 20,
      int offset = 0,
      ReportStatus? status,
      String? query,
    }) async {
      if (query != null) {
        expect(query, 'old bridge');
        expect(limit, 3);
        return ReportHistoryPage(reports: [report(99)], hasMore: false);
      }
      return ReportHistoryPage(reports: [report(1)], hasMore: false);
    });
    addTearDown(provider.dispose);
    provider.setCitizen('citizen-a');
    await provider.load();
    await provider.search(' old bridge ');

    expect(provider.recentReports.single.publicId, 'CR-1');
    expect(provider.searchResults.single.publicId, 'CR-99');
  });

  test('account changes discard an in-flight history response', () async {
    final request = Completer<ReportHistoryPage>();
    final provider = ReportHistoryProvider(
        fetchPage: ({
      int limit = 20,
      int offset = 0,
      ReportStatus? status,
      String? query,
    }) =>
            request.future);
    addTearDown(provider.dispose);
    provider.setCitizen('citizen-a');
    final load = provider.load();
    provider.setCitizen('citizen-b');
    request.complete(ReportHistoryPage(reports: [report(1)], hasMore: false));
    await load;

    expect(provider.reports, isEmpty);
    expect(provider.recentReports, isEmpty);
    expect(provider.hasLoaded, isFalse);
  });
}
