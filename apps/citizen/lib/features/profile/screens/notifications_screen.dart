import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../../core/providers/app_settings_provider.dart';
import '../../../core/router/app_router.dart';
import '../../report/models/submitted_report.dart';
import '../../report/providers/report_history_provider.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<AppSettingsProvider>();
    final history = context.watch<ReportHistoryProvider>();
    final updates = history.reports
        .where((report) => report.status != ReportStatus.pending)
        .toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: history.refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SwitchListTile(
              title: const Text('Report updates'),
              subtitle: const Text(
                  'Show activity when the status of a report changes.'),
              value: settings.notificationsEnabled,
              onChanged: settings.setNotificationsEnabled,
            ),
            const Divider(),
            if (!settings.notificationsEnabled)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Report update notifications are turned off.'),
              )
            else if (!history.hasLoaded)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (updates.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('No report updates yet.'),
              )
            else
              ...updates.map((report) => ListTile(
                    leading: Icon(_icon(report.status)),
                    title: Text(
                        '${report.publicId} is ${report.status.label.toLowerCase()}'),
                    subtitle: Text(report.category.label),
                    trailing: const Icon(Icons.chevron_right_rounded),
                    onTap: () => context.push(
                      AppRoutes.reportDetails
                          .replaceFirst(':id', report.publicId),
                    ),
                  )),
          ],
        ),
      ),
    );
  }

  static IconData _icon(ReportStatus status) => switch (status) {
        ReportStatus.resolved => Icons.check_circle_outline_rounded,
        ReportStatus.inProgress => Icons.sync_rounded,
        ReportStatus.rejected => Icons.cancel_outlined,
        _ => Icons.notifications_none_rounded,
      };
}
