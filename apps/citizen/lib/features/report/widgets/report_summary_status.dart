import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/report_summary_provider.dart';

/// Shared loading and retry feedback for Home and Profile statistics.
class ReportSummaryStatus extends StatelessWidget {
  const ReportSummaryStatus({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<ReportSummaryProvider>();
    if (state.isLoading) {
      return const LinearProgressIndicator(
          semanticsLabel: 'Loading report counts');
    }
    if (state.errorMessage == null) return const SizedBox.shrink();
    return Row(children: [
      Expanded(child: Text(state.errorMessage!)),
      TextButton(onPressed: () => state.refresh(), child: const Text('Retry')),
    ]);
  }
}
