class CitizenNotification {
  const CitizenNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.publicId,
    required this.reportStatus,
    required this.createdAt,
    required this.readAt,
    required this.route,
  });

  final String id;
  final String title;
  final String body;
  final String publicId;
  final String reportStatus;
  final DateTime createdAt;
  final DateTime? readAt;
  final String? route;

  bool get isRead => readAt != null;

  factory CitizenNotification.fromJson(Map<String, dynamic> json) {
    final data = json['data'] as Map<String, dynamic>? ?? const {};
    return CitizenNotification(
      id: json['id'] as String,
      title: json['title'] as String,
      body: json['body'] as String,
      publicId: json['publicId'] as String,
      reportStatus: json['reportStatus'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      readAt: json['readAt'] == null
          ? null
          : DateTime.parse(json['readAt'] as String),
      route: data['route'] as String?,
    );
  }

  CitizenNotification markRead() => CitizenNotification(
        id: id,
        title: title,
        body: body,
        publicId: publicId,
        reportStatus: reportStatus,
        createdAt: createdAt,
        readAt: readAt ?? DateTime.now(),
        route: route,
      );
}
