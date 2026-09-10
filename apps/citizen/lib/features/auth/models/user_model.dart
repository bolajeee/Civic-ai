class UserModel {
  final String id;
  final String publicId;
  final String email;
  final String? phone;
  final String? nin;
  final String role;
  final String status;
  final DateTime? createdAt;

  const UserModel({
    required this.id,
    required this.publicId,
    required this.email,
    this.phone,
    this.nin,
    required this.role,
    required this.status,
    this.createdAt,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] as String,
      publicId: json['public_id'] as String,
      email: json['email'] as String,
      phone: json['phone'] as String?,
      nin: json['nin'] as String?,
      role: json['role'] as String,
      status: (json['status'] as String?) ?? 'ACTIVE',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'public_id': publicId,
        'email': email,
        if (phone != null) 'phone': phone,
        if (nin != null) 'nin': nin,
        'role': role,
        'status': status,
        if (createdAt != null) 'created_at': createdAt!.toIso8601String(),
      };
}
