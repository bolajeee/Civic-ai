import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../../core/router/app_router.dart';
import '../../notifications/models/citizen_notification.dart';
import '../../notifications/providers/notification_provider.dart';
import '../../report/models/relative_time.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final notifications = context.watch<NotificationProvider>();
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: RefreshIndicator(
        onRefresh: notifications.refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SwitchListTile(
              title: const Text('Report updates'),
              subtitle: const Text(
                'Receive an update when one of your reports changes status.',
              ),
              value: notifications.enabled,
              onChanged:
                  notifications.loading ? null : notifications.setEnabled,
            ),
            if (!notifications.pushConfigured && notifications.enabled)
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Text(
                  'Push delivery is unavailable in this build. Updates will still appear here.',
                  style: TextStyle(fontSize: 12),
                ),
              ),
            const Divider(),
            if (notifications.error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  notifications.error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            if (notifications.loading && notifications.items.isEmpty)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (!notifications.enabled)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('Report update notifications are turned off.'),
              )
            else if (notifications.items.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('No report updates yet.'),
              )
            else
              ...notifications.items
                  .map((item) => _NotificationTile(item: item)),
          ],
        ),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.item});
  final CitizenNotification item;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(_icon(item.reportStatus)),
      title: Text(
        item.title,
        style: TextStyle(
          fontWeight: item.isRead ? FontWeight.normal : FontWeight.w700,
        ),
      ),
      subtitle: Text('${item.body}\n${relativeTime(item.createdAt)}'),
      isThreeLine: true,
      trailing: item.isRead
          ? const Icon(Icons.chevron_right_rounded)
          : const Badge(smallSize: 9),
      onTap: () async {
        await context.read<NotificationProvider>().markRead(item);
        if (!context.mounted) return;
        context.push(
          item.route ??
              AppRoutes.reportDetails.replaceFirst(':id', item.publicId),
        );
      },
    );
  }

  static IconData _icon(String status) => switch (status) {
        'RESOLVED' => Icons.check_circle_outline_rounded,
        'IN_PROGRESS' => Icons.sync_rounded,
        'REJECTED' => Icons.cancel_outlined,
        _ => Icons.notifications_none_rounded,
      };
}
