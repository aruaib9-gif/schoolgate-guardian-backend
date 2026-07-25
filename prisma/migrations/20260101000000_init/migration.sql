-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "full_name" TEXT,
    "school_id" TEXT,
    "person_id" TEXT,
    "user_category" TEXT,
    "gate_name" TEXT,
    "assigned_bus_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "profile_completed" BOOLEAN NOT NULL DEFAULT false,
    "last_login" TIMESTAMP(3),
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "logo_url" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "admin_email" TEXT,
    "subscription_plan" TEXT NOT NULL DEFAULT 'trial',
    "status" TEXT NOT NULL DEFAULT 'active',
    "max_users" INTEGER NOT NULL DEFAULT 500,
    "country" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "gate_locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB,
    "notes" TEXT,
    "city" TEXT,
    "state" TEXT,
    "admin_name" TEXT,
    "admin_phone" TEXT,
    "students" INTEGER,
    "staff" INTEGER,
    "gates" INTEGER,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "full_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp_number" TEXT,
    "category" TEXT NOT NULL,
    "portal_access" BOOLEAN NOT NULL DEFAULT false,
    "qr_code" TEXT NOT NULL,
    "photo_url" TEXT,
    "address" TEXT,
    "emergency_contact" TEXT,
    "emergency_phone" TEXT,
    "linked_children" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "father_email" TEXT,
    "mother_email" TEXT,
    "grade" TEXT,
    "department" TEXT,
    "current_status" TEXT NOT NULL DEFAULT 'outside',
    "registration_completed" BOOLEAN NOT NULL DEFAULT false,
    "registration_token" TEXT,
    "profile_completed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "invitation_id" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "class_name" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "room" TEXT,
    "class_teacher_id" TEXT,
    "class_teacher_name" TEXT,
    "student_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timetable" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "person_id" TEXT NOT NULL,
    "person_name" TEXT,
    "person_category" TEXT,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "scanned_by" TEXT,
    "gate_name" TEXT,
    "notes" TEXT,
    "pass_type" TEXT NOT NULL DEFAULT 'regular',
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_alerts" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "person_id" TEXT,
    "person_name" TEXT,
    "location" TEXT NOT NULL DEFAULT 'Main Gate',
    "status" TEXT NOT NULL DEFAULT 'unread',
    "acknowledged_by" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "security_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "student_id" TEXT NOT NULL,
    "student_name" TEXT,
    "teacher_id" TEXT NOT NULL,
    "teacher_name" TEXT,
    "class_name" TEXT,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'present',
    "notes" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_passes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "parent_id" TEXT NOT NULL,
    "parent_name" TEXT,
    "child_id" TEXT NOT NULL,
    "child_name" TEXT,
    "purpose" TEXT NOT NULL,
    "contact_phone" TEXT,
    "special_instructions" TEXT,
    "qr_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "valid_until" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "authorized_person_name" TEXT,
    "scheduled_date" TEXT,
    "scheduled_time" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "one_time_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_passes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "guest_name" TEXT NOT NULL,
    "guest_phone" TEXT,
    "guest_email" TEXT,
    "purpose" TEXT NOT NULL,
    "host_name" TEXT,
    "qr_code" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "used_at" TIMESTAMP(3),
    "scheduled_date" TEXT,
    "scheduled_time" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "guest_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "visitor_name" TEXT NOT NULL,
    "visitor_phone" TEXT,
    "visitor_email" TEXT,
    "visitor_company" TEXT,
    "visitor_photo_url" TEXT,
    "purpose" TEXT NOT NULL,
    "host_person_id" TEXT,
    "host_name" TEXT NOT NULL,
    "host_email" TEXT,
    "host_phone" TEXT,
    "qr_code" TEXT NOT NULL,
    "badge_number" TEXT,
    "visit_date" TEXT NOT NULL,
    "expected_arrival" TEXT,
    "expected_duration" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pre_registered',
    "check_in_time" TIMESTAMP(3),
    "check_out_time" TIMESTAMP(3),
    "checked_in_by" TEXT,
    "checked_out_by" TEXT,
    "host_notified" BOOLEAN NOT NULL DEFAULT false,
    "host_notified_at" TIMESTAMP(3),
    "notes" TEXT,
    "items_carried" TEXT,
    "vehicle_info" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_buses" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "bus_name" TEXT NOT NULL,
    "bus_number" TEXT,
    "plate_number" TEXT,
    "driver_name" TEXT,
    "driver_phone" TEXT,
    "driver_person_id" TEXT,
    "route_name" TEXT,
    "route_description" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "assigned_student_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stops" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "current_status" TEXT NOT NULL DEFAULT 'idle',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_security_user_id" TEXT,
    "assigned_security_name" TEXT,
    "assigned_security_email" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "school_buses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_scan_logs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "bus_id" TEXT NOT NULL,
    "bus_name" TEXT,
    "bus_number" TEXT,
    "driver_name" TEXT,
    "person_id" TEXT NOT NULL,
    "person_name" TEXT,
    "person_category" TEXT,
    "action" TEXT NOT NULL,
    "trip_direction" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "scanned_by" TEXT,
    "scanned_by_name" TEXT,
    "guardian_person_id" TEXT,
    "guardian_name" TEXT,
    "guardian_relationship" TEXT,
    "stop_name" TEXT,
    "notes" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "bus_scan_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT,
    "sender_role" TEXT,
    "recipient_type" TEXT NOT NULL,
    "recipient_id" TEXT,
    "recipient_name" TEXT,
    "recipient_role" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "read_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "school_name" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT,
    "department" TEXT,
    "grade" TEXT,
    "portal_access" BOOLEAN NOT NULL DEFAULT true,
    "invite_token" TEXT NOT NULL,
    "temp_password" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "invited_by" TEXT,
    "invited_by_name" TEXT,
    "person_id" TEXT,
    "notes" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "role_name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_configs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "role" TEXT NOT NULL,
    "cards" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "show_stats" BOOLEAN NOT NULL DEFAULT false,
    "welcome_message" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "dashboard_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "config_key" TEXT NOT NULL,
    "config_value" TEXT NOT NULL,
    "config_type" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "actor_email" TEXT,
    "actor_name" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "description" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "title" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "company" TEXT,
    "source" TEXT NOT NULL DEFAULT 'other',
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "estimated_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "assigned_to" TEXT,
    "assigned_to_name" TEXT,
    "notes" TEXT,
    "next_follow_up" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lost_reason" TEXT,
    "probability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "address" TEXT,
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tier" TEXT NOT NULL DEFAULT 'bronze',
    "assigned_to" TEXT,
    "assigned_to_name" TEXT,
    "total_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "lead_id" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "crm_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_products" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "sku" TEXT,
    "unit_price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "crm_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_orders" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "order_number" TEXT,
    "document_type" TEXT NOT NULL DEFAULT 'order',
    "customer_id" TEXT NOT NULL,
    "customer_name" TEXT,
    "sales_rep_email" TEXT,
    "sales_rep_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "items" JSONB,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "notes" TEXT,
    "due_date" TEXT,
    "paid_at" TIMESTAMP(3),
    "quote_valid_until" TEXT,
    "invoice_number" TEXT,
    "receipt_number" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "crm_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'note',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "lead_id" TEXT,
    "customer_id" TEXT,
    "related_name" TEXT,
    "sales_rep_email" TEXT,
    "sales_rep_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "scheduled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "outcome" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_sales_targets" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "sales_rep_email" TEXT NOT NULL,
    "sales_rep_name" TEXT,
    "period" TEXT NOT NULL,
    "period_type" TEXT NOT NULL DEFAULT 'monthly',
    "target_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target_deals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actual_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actual_deals" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "crm_sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_invitations" (
    "id" TEXT NOT NULL,
    "school_name" TEXT NOT NULL,
    "code" TEXT,
    "city" TEXT,
    "state" TEXT,
    "admin_name" TEXT,
    "admin_email" TEXT NOT NULL,
    "admin_phone" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "invite_token" TEXT NOT NULL,
    "invited_by" TEXT,
    "accepted_at" TIMESTAMP(3),
    "school_id" TEXT,
    "notes" TEXT,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,

    CONSTRAINT "school_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_config" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "platform_name" TEXT NOT NULL DEFAULT 'School Guardian',
    "support_email" TEXT NOT NULL DEFAULT 'support@schoolguardian.ng',
    "default_plan" TEXT NOT NULL DEFAULT 'basic',
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "attendance_cutoff" TEXT NOT NULL DEFAULT '08:15',
    "allow_self_signup" BOOLEAN NOT NULL DEFAULT false,
    "maintenance_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_school_id_idx" ON "users"("school_id");

-- CreateIndex
CREATE INDEX "users_user_category_idx" ON "users"("user_category");

-- CreateIndex
CREATE INDEX "users_person_id_idx" ON "users"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "schools_code_key" ON "schools"("code");

-- CreateIndex
CREATE INDEX "schools_status_idx" ON "schools"("status");

-- CreateIndex
CREATE INDEX "schools_subscription_plan_idx" ON "schools"("subscription_plan");

-- CreateIndex
CREATE INDEX "schools_state_idx" ON "schools"("state");

-- CreateIndex
CREATE INDEX "people_school_id_idx" ON "people"("school_id");

-- CreateIndex
CREATE INDEX "people_category_idx" ON "people"("category");

-- CreateIndex
CREATE INDEX "people_qr_code_idx" ON "people"("qr_code");

-- CreateIndex
CREATE INDEX "people_email_idx" ON "people"("email");

-- CreateIndex
CREATE INDEX "classes_school_id_idx" ON "classes"("school_id");

-- CreateIndex
CREATE INDEX "access_logs_school_id_idx" ON "access_logs"("school_id");

-- CreateIndex
CREATE INDEX "access_logs_person_id_idx" ON "access_logs"("person_id");

-- CreateIndex
CREATE INDEX "access_logs_timestamp_idx" ON "access_logs"("timestamp");

-- CreateIndex
CREATE INDEX "security_alerts_school_id_idx" ON "security_alerts"("school_id");

-- CreateIndex
CREATE INDEX "security_alerts_status_idx" ON "security_alerts"("status");

-- CreateIndex
CREATE INDEX "attendance_school_id_idx" ON "attendance"("school_id");

-- CreateIndex
CREATE INDEX "attendance_student_id_idx" ON "attendance"("student_id");

-- CreateIndex
CREATE INDEX "attendance_date_idx" ON "attendance"("date");

-- CreateIndex
CREATE INDEX "one_time_passes_school_id_idx" ON "one_time_passes"("school_id");

-- CreateIndex
CREATE INDEX "one_time_passes_qr_code_idx" ON "one_time_passes"("qr_code");

-- CreateIndex
CREATE INDEX "one_time_passes_status_idx" ON "one_time_passes"("status");

-- CreateIndex
CREATE INDEX "guest_passes_school_id_idx" ON "guest_passes"("school_id");

-- CreateIndex
CREATE INDEX "guest_passes_qr_code_idx" ON "guest_passes"("qr_code");

-- CreateIndex
CREATE INDEX "guest_passes_status_idx" ON "guest_passes"("status");

-- CreateIndex
CREATE INDEX "visitors_school_id_idx" ON "visitors"("school_id");

-- CreateIndex
CREATE INDEX "visitors_status_idx" ON "visitors"("status");

-- CreateIndex
CREATE INDEX "visitors_visit_date_idx" ON "visitors"("visit_date");

-- CreateIndex
CREATE INDEX "school_buses_school_id_idx" ON "school_buses"("school_id");

-- CreateIndex
CREATE INDEX "bus_scan_logs_school_id_idx" ON "bus_scan_logs"("school_id");

-- CreateIndex
CREATE INDEX "bus_scan_logs_bus_id_idx" ON "bus_scan_logs"("bus_id");

-- CreateIndex
CREATE INDEX "bus_scan_logs_person_id_idx" ON "bus_scan_logs"("person_id");

-- CreateIndex
CREATE INDEX "bus_scan_logs_timestamp_idx" ON "bus_scan_logs"("timestamp");

-- CreateIndex
CREATE INDEX "messages_school_id_idx" ON "messages"("school_id");

-- CreateIndex
CREATE INDEX "messages_recipient_id_idx" ON "messages"("recipient_id");

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- CreateIndex
CREATE INDEX "invitations_school_id_idx" ON "invitations"("school_id");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "invitations_invite_token_idx" ON "invitations"("invite_token");

-- CreateIndex
CREATE INDEX "role_permissions_school_id_idx" ON "role_permissions"("school_id");

-- CreateIndex
CREATE INDEX "role_permissions_role_name_idx" ON "role_permissions"("role_name");

-- CreateIndex
CREATE INDEX "dashboard_configs_school_id_idx" ON "dashboard_configs"("school_id");

-- CreateIndex
CREATE INDEX "dashboard_configs_role_idx" ON "dashboard_configs"("role");

-- CreateIndex
CREATE INDEX "system_configs_school_id_idx" ON "system_configs"("school_id");

-- CreateIndex
CREATE INDEX "system_configs_config_key_idx" ON "system_configs"("config_key");

-- CreateIndex
CREATE INDEX "audit_logs_school_id_idx" ON "audit_logs"("school_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_idx" ON "audit_logs"("entity_type");

-- CreateIndex
CREATE INDEX "crm_leads_school_id_idx" ON "crm_leads"("school_id");

-- CreateIndex
CREATE INDEX "crm_leads_status_idx" ON "crm_leads"("status");

-- CreateIndex
CREATE INDEX "crm_leads_assigned_to_idx" ON "crm_leads"("assigned_to");

-- CreateIndex
CREATE INDEX "crm_customers_school_id_idx" ON "crm_customers"("school_id");

-- CreateIndex
CREATE INDEX "crm_customers_status_idx" ON "crm_customers"("status");

-- CreateIndex
CREATE INDEX "crm_customers_assigned_to_idx" ON "crm_customers"("assigned_to");

-- CreateIndex
CREATE INDEX "crm_products_school_id_idx" ON "crm_products"("school_id");

-- CreateIndex
CREATE INDEX "crm_orders_school_id_idx" ON "crm_orders"("school_id");

-- CreateIndex
CREATE INDEX "crm_orders_customer_id_idx" ON "crm_orders"("customer_id");

-- CreateIndex
CREATE INDEX "crm_orders_status_idx" ON "crm_orders"("status");

-- CreateIndex
CREATE INDEX "crm_activities_school_id_idx" ON "crm_activities"("school_id");

-- CreateIndex
CREATE INDEX "crm_activities_lead_id_idx" ON "crm_activities"("lead_id");

-- CreateIndex
CREATE INDEX "crm_activities_customer_id_idx" ON "crm_activities"("customer_id");

-- CreateIndex
CREATE INDEX "crm_sales_targets_school_id_idx" ON "crm_sales_targets"("school_id");

-- CreateIndex
CREATE INDEX "crm_sales_targets_sales_rep_email_idx" ON "crm_sales_targets"("sales_rep_email");

-- CreateIndex
CREATE INDEX "school_invitations_status_idx" ON "school_invitations"("status");

-- CreateIndex
CREATE INDEX "school_invitations_admin_email_idx" ON "school_invitations"("admin_email");

-- CreateIndex
CREATE INDEX "school_invitations_invite_token_idx" ON "school_invitations"("invite_token");

