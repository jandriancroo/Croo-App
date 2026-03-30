export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      alarm_task_completions: {
        Row: {
          completed_at: string
          completed_by: string | null
          created_at: string
          id: string
          interval_key: string
          task_id: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          id?: string
          interval_key: string
          task_id: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          id?: string
          interval_key?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alarm_task_completions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alarm_task_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_queue: {
        Row: {
          alert_type: string
          created_at: string
          dedup_key: string
          id: string
          location_id: string | null
          payload: Json
          push_error: string | null
          push_sent: boolean
          push_sent_at: string | null
          retry_count: number
        }
        Insert: {
          alert_type: string
          created_at?: string
          dedup_key: string
          id?: string
          location_id?: string | null
          payload?: Json
          push_error?: string | null
          push_sent?: boolean
          push_sent_at?: string | null
          retry_count?: number
        }
        Update: {
          alert_type?: string
          created_at?: string
          dedup_key?: string
          id?: string
          location_id?: string | null
          payload?: Json
          push_error?: string | null
          push_sent?: boolean
          push_sent_at?: string | null
          retry_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "alert_queue_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement_reads: {
        Row: {
          chat_id: string
          id: string
          opened_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          id?: string
          opened_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          id?: string
          opened_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      applicant_flags: {
        Row: {
          application_id: string
          created_at: string
          flag_color: Database["public"]["Enums"]["applicant_flag_color"]
          id: string
          reason: string | null
          set_by: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          flag_color?: Database["public"]["Enums"]["applicant_flag_color"]
          id?: string
          reason?: string | null
          set_by?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          flag_color?: Database["public"]["Enums"]["applicant_flag_color"]
          id?: string
          reason?: string | null
          set_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applicant_flags_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applicant_notes: {
        Row: {
          application_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
        }
        Insert: {
          application_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
        }
        Update: {
          application_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "applicant_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applicant_push_subscriptions: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          platform: string
          subscription_data: string
          updated_at: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          platform?: string
          subscription_data: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          platform?: string
          subscription_data?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applicant_push_subscriptions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "hiring_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_requests: {
        Row: {
          created_at: string
          denial_reason: string | null
          edited_at: string | null
          edited_by: string | null
          end_date: string | null
          end_time: string | null
          hours_requested: number
          id: string
          location_id: string | null
          notes: string | null
          request_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          start_time: string | null
          status: string
          time_scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          denial_reason?: string | null
          edited_at?: string | null
          edited_by?: string | null
          end_date?: string | null
          end_time?: string | null
          hours_requested?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          request_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          start_time?: string | null
          status?: string
          time_scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          denial_reason?: string | null
          edited_at?: string | null
          edited_by?: string | null
          end_date?: string | null
          end_time?: string | null
          hours_requested?: number
          id?: string
          location_id?: string | null
          notes?: string | null
          request_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          start_time?: string | null
          status?: string
          time_scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_requests_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bounced_emails: {
        Row: {
          bounce_count: number
          bounce_reason: string | null
          bounced_at: string
          created_at: string
          email_address: string
          first_bounced_at: string
          id: string
          updated_at: string
        }
        Insert: {
          bounce_count?: number
          bounce_reason?: string | null
          bounced_at?: string
          created_at?: string
          email_address: string
          first_bounced_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          bounce_count?: number
          bounce_reason?: string | null
          bounced_at?: string
          created_at?: string
          email_address?: string
          first_bounced_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      brand_event_categories: {
        Row: {
          brand_id: string
          color: string
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          brand_id: string
          color?: string
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          brand_id?: string
          color?: string
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_event_categories_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_inventory_categories: {
        Row: {
          brand_id: string
          created_at: string
          display_order: number
          id: string
          name: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_inventory_categories_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_inventory_deployments: {
        Row: {
          calculated_baseline: number | null
          deployed_at: string
          deployed_by: string | null
          id: string
          inventory_item_id: string
          location_id: string
          needs_review: boolean
          review_reason: string | null
          template_id: string
          weight_per_unit: number | null
        }
        Insert: {
          calculated_baseline?: number | null
          deployed_at?: string
          deployed_by?: string | null
          id?: string
          inventory_item_id: string
          location_id: string
          needs_review?: boolean
          review_reason?: string | null
          template_id: string
          weight_per_unit?: number | null
        }
        Update: {
          calculated_baseline?: number | null
          deployed_at?: string
          deployed_by?: string | null
          id?: string
          inventory_item_id?: string
          location_id?: string
          needs_review?: boolean
          review_reason?: string | null
          template_id?: string
          weight_per_unit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_inventory_deployments_deployed_by_fkey"
            columns: ["deployed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_inventory_deployments_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_inventory_deployments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_inventory_deployments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "brand_inventory_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_inventory_staging: {
        Row: {
          brand_id: string
          category: string | null
          created_at: string
          id: string
          item_number: string | null
          matched_template_id: string | null
          original_vendor_name: string | null
          pack_size: string | null
          product_name: string
          status: string
          vendor_source: string | null
        }
        Insert: {
          brand_id: string
          category?: string | null
          created_at?: string
          id?: string
          item_number?: string | null
          matched_template_id?: string | null
          original_vendor_name?: string | null
          pack_size?: string | null
          product_name: string
          status?: string
          vendor_source?: string | null
        }
        Update: {
          brand_id?: string
          category?: string | null
          created_at?: string
          id?: string
          item_number?: string | null
          matched_template_id?: string | null
          original_vendor_name?: string | null
          pack_size?: string | null
          product_name?: string
          status?: string
          vendor_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_inventory_staging_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_inventory_staging_matched_template_id_fkey"
            columns: ["matched_template_id"]
            isOneToOne: false
            referencedRelation: "brand_inventory_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_inventory_templates: {
        Row: {
          brand_id: string
          category: string | null
          common_name: string | null
          created_at: string
          created_by: string | null
          id: string
          is_recipe: boolean
          is_weight_based: boolean
          item_number: string | null
          match_keywords: string[]
          pa_item_id: string | null
          pan_baseline_key: string
          pan_enabled_keys: string[]
          pan_overrides: Json | null
          pan_units_per_lb: number | null
          pan_units_per_unit: number | null
          product_group_name: string | null
          product_group_pos_categories: string[] | null
          product_group_pos_items: string[] | null
          product_name: string
          recipe_ingredients: Json | null
          recipe_yield_qty: number | null
          recipe_yield_unit: string | null
          shortcut_location_names: string[] | null
          source_item_id: string | null
          source_location_id: string | null
          status: string
          storage_location_name: string | null
          updated_at: string
          usage_rate: number | null
          usage_rate_manual_override: boolean | null
          usage_rate_mappings: Json | null
          usage_rate_unit: string | null
          vendor_source: string | null
        }
        Insert: {
          brand_id: string
          category?: string | null
          common_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_recipe?: boolean
          is_weight_based?: boolean
          item_number?: string | null
          match_keywords?: string[]
          pa_item_id?: string | null
          pan_baseline_key?: string
          pan_enabled_keys?: string[]
          pan_overrides?: Json | null
          pan_units_per_lb?: number | null
          pan_units_per_unit?: number | null
          product_group_name?: string | null
          product_group_pos_categories?: string[] | null
          product_group_pos_items?: string[] | null
          product_name: string
          recipe_ingredients?: Json | null
          recipe_yield_qty?: number | null
          recipe_yield_unit?: string | null
          shortcut_location_names?: string[] | null
          source_item_id?: string | null
          source_location_id?: string | null
          status?: string
          storage_location_name?: string | null
          updated_at?: string
          usage_rate?: number | null
          usage_rate_manual_override?: boolean | null
          usage_rate_mappings?: Json | null
          usage_rate_unit?: string | null
          vendor_source?: string | null
        }
        Update: {
          brand_id?: string
          category?: string | null
          common_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_recipe?: boolean
          is_weight_based?: boolean
          item_number?: string | null
          match_keywords?: string[]
          pa_item_id?: string | null
          pan_baseline_key?: string
          pan_enabled_keys?: string[]
          pan_overrides?: Json | null
          pan_units_per_lb?: number | null
          pan_units_per_unit?: number | null
          product_group_name?: string | null
          product_group_pos_categories?: string[] | null
          product_group_pos_items?: string[] | null
          product_name?: string
          recipe_ingredients?: Json | null
          recipe_yield_qty?: number | null
          recipe_yield_unit?: string | null
          shortcut_location_names?: string[] | null
          source_item_id?: string | null
          source_location_id?: string | null
          status?: string
          storage_location_name?: string | null
          updated_at?: string
          usage_rate?: number | null
          usage_rate_manual_override?: boolean | null
          usage_rate_mappings?: Json | null
          usage_rate_unit?: string | null
          vendor_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_inventory_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_inventory_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_inventory_templates_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_inventory_templates_source_location_id_fkey"
            columns: ["source_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_members: {
        Row: {
          brand_id: string
          brand_role: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          brand_id: string
          brand_role?: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          brand_role?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      catering_orders: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          customer_name: string
          headcount: number | null
          id: string
          items: Json
          location_id: string | null
          notes: string | null
          order_number: string | null
          pickup_date: string
          pickup_time: string
          source_url: string | null
          status: string
          total_price: number | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          customer_name: string
          headcount?: number | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          order_number?: string | null
          pickup_date: string
          pickup_time: string
          source_url?: string | null
          status?: string
          total_price?: number | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          customer_name?: string
          headcount?: number | null
          id?: string
          items?: Json
          location_id?: string | null
          notes?: string | null
          order_number?: string | null
          pickup_date?: string
          pickup_time?: string
          source_url?: string | null
          status?: string
          total_price?: number | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catering_orders_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          certificate_url: string
          certification_type: string
          created_at: string
          expiration_date: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          certificate_url: string
          certification_type: string
          created_at?: string
          expiration_date: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          certificate_url?: string
          certification_type?: string
          created_at?: string
          expiration_date?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certifications_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      changelog_entries: {
        Row: {
          created_at: string
          description: string | null
          entry_date: string
          entry_type: string
          id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entry_date?: string
          entry_type: string
          id?: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entry_date?: string
          entry_type?: string
          id?: string
          title?: string
        }
        Relationships: []
      }
      chat_members: {
        Row: {
          chat_id: string
          id: string
          is_pinned: boolean
          joined_at: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          chat_id: string
          id?: string
          is_pinned?: boolean
          joined_at?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          chat_id?: string
          id?: string
          is_pinned?: boolean
          joined_at?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          created_by: string
          group_image_url: string | null
          id: string
          is_announcement: boolean
          is_arcade: boolean
          is_group: boolean
          location_id: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          group_image_url?: string | null
          id?: string
          is_announcement?: boolean
          is_arcade?: boolean
          is_group?: boolean
          location_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          group_image_url?: string | null
          id?: string
          is_announcement?: boolean
          is_arcade?: boolean
          is_group?: boolean
          location_id?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          checklist_id: string
          created_at: string | null
          days_of_week: number[] | null
          id: string
          is_required: boolean | null
          item_type: string
          manager_shift: string | null
          options: Json | null
          order_index: number
          position: string | null
          question: string
          reference_image_url: string | null
          reference_link: string | null
          reference_notes: string | null
          reference_video_url: string | null
          requires_temperature_validation: boolean
          temperature_alert_enabled: boolean
        }
        Insert: {
          checklist_id: string
          created_at?: string | null
          days_of_week?: number[] | null
          id?: string
          is_required?: boolean | null
          item_type: string
          manager_shift?: string | null
          options?: Json | null
          order_index: number
          position?: string | null
          question: string
          reference_image_url?: string | null
          reference_link?: string | null
          reference_notes?: string | null
          reference_video_url?: string | null
          requires_temperature_validation?: boolean
          temperature_alert_enabled?: boolean
        }
        Update: {
          checklist_id?: string
          created_at?: string | null
          days_of_week?: number[] | null
          id?: string
          is_required?: boolean | null
          item_type?: string
          manager_shift?: string | null
          options?: Json | null
          order_index?: number
          position?: string | null
          question?: string
          reference_image_url?: string | null
          reference_link?: string | null
          reference_notes?: string | null
          reference_video_url?: string | null
          requires_temperature_validation?: boolean
          temperature_alert_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_notification_logs: {
        Row: {
          checklist_id: string
          id: string
          location_id: string
          notification_type: string
          sent_at: string
          trigger_user_id: string | null
        }
        Insert: {
          checklist_id: string
          id?: string
          location_id: string
          notification_type: string
          sent_at?: string
          trigger_user_id?: string | null
        }
        Update: {
          checklist_id?: string
          id?: string
          location_id?: string
          notification_type?: string
          sent_at?: string
          trigger_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_notification_logs_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_notification_logs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_notification_logs_trigger_user_id_fkey"
            columns: ["trigger_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_responses: {
        Row: {
          completed_by: string | null
          created_at: string | null
          extracted_temperature: number | null
          id: string
          item_id: string
          response_image_url: string | null
          response_image_urls: Json | null
          response_text: string | null
          submission_id: string
          temperature_valid: boolean | null
          temperature_validated_at: string | null
        }
        Insert: {
          completed_by?: string | null
          created_at?: string | null
          extracted_temperature?: number | null
          id?: string
          item_id: string
          response_image_url?: string | null
          response_image_urls?: Json | null
          response_text?: string | null
          submission_id: string
          temperature_valid?: boolean | null
          temperature_validated_at?: string | null
        }
        Update: {
          completed_by?: string | null
          created_at?: string | null
          extracted_temperature?: number | null
          id?: string
          item_id?: string
          response_image_url?: string | null
          response_image_urls?: Json | null
          response_text?: string | null
          submission_id?: string
          temperature_valid?: boolean | null
          temperature_validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responses_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "checklist_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_role_tags: {
        Row: {
          checklist_id: string
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          checklist_id: string
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          checklist_id?: string
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "checklist_role_tags_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_submissions: {
        Row: {
          checklist_id: string
          id: string
          location_id: string | null
          notes: string | null
          submitted_at: string | null
          submitted_by: string
        }
        Insert: {
          checklist_id: string
          id?: string
          location_id?: string | null
          notes?: string | null
          submitted_at?: string | null
          submitted_by: string
        }
        Update: {
          checklist_id?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          submitted_at?: string | null
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_submissions_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          assigned_day_of_week: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          display_order: number | null
          due_by_time: string | null
          enable_am_pm_division: boolean | null
          frequency: string
          id: string
          is_active: boolean | null
          location_id: string | null
          lock_until_time: string | null
          position_filtering_enabled: boolean | null
          template_type: string | null
          title: string
          updated_at: string | null
          visible_days_before_month_end: number | null
        }
        Insert: {
          assigned_day_of_week?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          due_by_time?: string | null
          enable_am_pm_division?: boolean | null
          frequency: string
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          lock_until_time?: string | null
          position_filtering_enabled?: boolean | null
          template_type?: string | null
          title: string
          updated_at?: string | null
          visible_days_before_month_end?: number | null
        }
        Update: {
          assigned_day_of_week?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          due_by_time?: string | null
          enable_am_pm_division?: boolean | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          lock_until_time?: string | null
          position_filtering_enabled?: boolean | null
          template_type?: string | null
          title?: string
          updated_at?: string | null
          visible_days_before_month_end?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      croo_ai_briefing_reads: {
        Row: {
          briefing_id: string
          id: string
          read_at: string
          user_id: string
        }
        Insert: {
          briefing_id: string
          id?: string
          read_at?: string
          user_id: string
        }
        Update: {
          briefing_id?: string
          id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "croo_ai_briefing_reads_briefing_id_fkey"
            columns: ["briefing_id"]
            isOneToOne: false
            referencedRelation: "croo_ai_briefings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "croo_ai_briefing_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      croo_ai_briefings: {
        Row: {
          briefing_date: string
          content: string
          created_at: string
          id: string
          location_id: string
        }
        Insert: {
          briefing_date: string
          content: string
          created_at?: string
          id?: string
          location_id: string
        }
        Update: {
          briefing_date?: string
          content?: string
          created_at?: string
          id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "croo_ai_briefings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      croo_cash_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          is_weekend: boolean
          notes: string | null
          shift_date: string
          shift_offer_id: string | null
          transaction_type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          is_weekend?: boolean
          notes?: string | null
          shift_date: string
          shift_offer_id?: string | null
          transaction_type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          is_weekend?: boolean
          notes?: string | null
          shift_date?: string
          shift_offer_id?: string | null
          transaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "croo_cash_transactions_shift_offer_id_fkey"
            columns: ["shift_offer_id"]
            isOneToOne: false
            referencedRelation: "shift_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "croo_cash_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_spot_count_items: {
        Row: {
          created_at: string
          id: string
          item_id: string
          previous_quantity: number | null
          quantity: number
          spot_count_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          previous_quantity?: number | null
          quantity?: number
          spot_count_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          previous_quantity?: number | null
          quantity?: number
          spot_count_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_spot_count_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_spot_count_items_spot_count_id_fkey"
            columns: ["spot_count_id"]
            isOneToOne: false
            referencedRelation: "daily_spot_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_spot_counts: {
        Row: {
          completed_at: string | null
          count_date: string
          counted_by: string | null
          created_at: string
          id: string
          location_id: string
          notes: string | null
          started_at: string
        }
        Insert: {
          completed_at?: string | null
          count_date: string
          counted_by?: string | null
          created_at?: string
          id?: string
          location_id: string
          notes?: string | null
          started_at?: string
        }
        Update: {
          completed_at?: string | null
          count_date?: string
          counted_by?: string | null
          created_at?: string
          id?: string
          location_id?: string
          notes?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_spot_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_summary_logs: {
        Row: {
          id: string
          location_id: string
          recipient_count: number | null
          sent_at: string
          summary_date: string
        }
        Insert: {
          id?: string
          location_id: string
          recipient_count?: number | null
          sent_at?: string
          summary_date: string
        }
        Update: {
          id?: string
          location_id?: string
          recipient_count?: number | null
          sent_at?: string
          summary_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_summary_logs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_tips: {
        Row: {
          created_at: string
          fetched_at: string
          id: string
          location_id: string
          tip_date: string
          total_cash_tips: number
          total_cc_tips: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          id?: string
          location_id: string
          tip_date: string
          total_cash_tips?: number
          total_cc_tips?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          fetched_at?: string
          id?: string
          location_id?: string
          tip_date?: string
          total_cash_tips?: number
          total_cc_tips?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_tips_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_queue: {
        Row: {
          created_at: string
          dedup_key: string | null
          email_type: string | null
          from_address: string
          html: string
          id: string
          last_error: string | null
          location_id: string | null
          metadata: Json | null
          retry_count: number
          sent_at: string | null
          source: string | null
          status: string
          subject: string
          target_date: string | null
          to_addresses: string[]
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          email_type?: string | null
          from_address?: string
          html: string
          id?: string
          last_error?: string | null
          location_id?: string | null
          metadata?: Json | null
          retry_count?: number
          sent_at?: string | null
          source?: string | null
          status?: string
          subject: string
          target_date?: string | null
          to_addresses: string[]
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          email_type?: string | null
          from_address?: string
          html?: string
          id?: string
          last_error?: string | null
          location_id?: string | null
          metadata?: Json | null
          retry_count?: number
          sent_at?: string | null
          source?: string | null
          status?: string
          subject?: string
          target_date?: string | null
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "email_queue_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_notes: {
        Row: {
          created_at: string
          created_by: string
          id: string
          note: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          note: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          note?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_writeup_reasons: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          is_active: boolean | null
          location_id: string | null
          reason: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          reason: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          location_id?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_writeup_reasons_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_writeups: {
        Row: {
          created_at: string
          created_by: string
          employee_id: string
          id: string
          is_final_warning: boolean
          issue_description: string
          location_id: string
          next_steps: string
          photo_url: string | null
          reason: string
          signature_url: string | null
          signed_at: string | null
          task_id: string | null
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          employee_id: string
          id?: string
          is_final_warning?: boolean
          issue_description: string
          location_id: string
          next_steps: string
          photo_url?: string | null
          reason: string
          signature_url?: string | null
          signed_at?: string | null
          task_id?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          employee_id?: string
          id?: string
          is_final_warning?: boolean
          issue_description?: string
          location_id?: string
          next_steps?: string
          photo_url?: string | null
          reason?: string
          signature_url?: string | null
          signed_at?: string | null
          task_id?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_writeups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_writeups_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_writeups_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_writeups_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      event_attendees: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "schedule_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_categories: {
        Row: {
          color: string
          created_at: string | null
          id: string
          location_id: string | null
          name: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          location_id?: string | null
          name: string
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_categories_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_task_completions: {
        Row: {
          completed_at: string
          completed_by: string
          completed_date: string
          event_id: string
          id: string
        }
        Insert: {
          completed_at?: string
          completed_by: string
          completed_date: string
          event_id: string
          id?: string
        }
        Update: {
          completed_at?: string
          completed_by?: string
          completed_date?: string
          event_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_task_completions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_task_completions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "schedule_events"
            referencedColumns: ["id"]
          },
        ]
      }
      food_safety_audits: {
        Row: {
          audit_date: string
          audit_url: string
          created_at: string
          first_priority_corrected: number[] | null
          first_priority_items: Json | null
          id: string
          item_corrections: Json | null
          location_id: string
          manager_name: string | null
          notes: string | null
          second_priority_corrected: number[] | null
          second_priority_items: Json | null
          summary_extracted_at: string | null
          third_priority_corrected: number[] | null
          third_priority_items: Json | null
          updated_at: string
          uploaded_by: string
          visit_score: string | null
        }
        Insert: {
          audit_date: string
          audit_url: string
          created_at?: string
          first_priority_corrected?: number[] | null
          first_priority_items?: Json | null
          id?: string
          item_corrections?: Json | null
          location_id: string
          manager_name?: string | null
          notes?: string | null
          second_priority_corrected?: number[] | null
          second_priority_items?: Json | null
          summary_extracted_at?: string | null
          third_priority_corrected?: number[] | null
          third_priority_items?: Json | null
          updated_at?: string
          uploaded_by: string
          visit_score?: string | null
        }
        Update: {
          audit_date?: string
          audit_url?: string
          created_at?: string
          first_priority_corrected?: number[] | null
          first_priority_items?: Json | null
          id?: string
          item_corrections?: Json | null
          location_id?: string
          manager_name?: string | null
          notes?: string | null
          second_priority_corrected?: number[] | null
          second_priority_items?: Json | null
          summary_extracted_at?: string | null
          third_priority_corrected?: number[] | null
          third_priority_items?: Json | null
          updated_at?: string
          uploaded_by?: string
          visit_score?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_safety_audits_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "food_safety_audits_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_high_scores: {
        Row: {
          created_at: string
          game_type: string
          id: string
          score: number
          user_id: string
        }
        Insert: {
          created_at?: string
          game_type: string
          id?: string
          score: number
          user_id: string
        }
        Update: {
          created_at?: string
          game_type?: string
          id?: string
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_high_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hiring_conversations: {
        Row: {
          access_token: string
          application_id: string
          created_at: string
          id: string
          last_read_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string
          application_id: string
          created_at?: string
          id?: string
          last_read_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          application_id?: string
          created_at?: string
          id?: string
          last_read_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hiring_conversations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      hiring_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string | null
          sender_type: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_type: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "hiring_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "hiring_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hiring_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          holiday_date: string
          holiday_name: string
          holiday_type: string
          id: string
          is_recurring: boolean
          location_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          holiday_date: string
          holiday_name: string
          holiday_type?: string
          id?: string
          is_recurring?: boolean
          location_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          holiday_date?: string
          holiday_name?: string
          holiday_type?: string
          id?: string
          is_recurring?: boolean
          location_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holidays_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      i9_audit_log: {
        Row: {
          action: string
          created_at: string
          document_type: Database["public"]["Enums"]["i9_document_type"] | null
          employee_id: string
          employee_name: string | null
          id: string
          location_id: string
          metadata: Json | null
          performed_by: string
          performed_by_name: string | null
          request_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          document_type?: Database["public"]["Enums"]["i9_document_type"] | null
          employee_id: string
          employee_name?: string | null
          id?: string
          location_id: string
          metadata?: Json | null
          performed_by: string
          performed_by_name?: string | null
          request_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          document_type?: Database["public"]["Enums"]["i9_document_type"] | null
          employee_id?: string
          employee_name?: string | null
          id?: string
          location_id?: string
          metadata?: Json | null
          performed_by?: string
          performed_by_name?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "i9_audit_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "i9_audit_log_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "i9_audit_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "i9_audit_log_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "i9_document_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      i9_document_requests: {
        Row: {
          created_at: string
          document_types: Database["public"]["Enums"]["i9_document_type"][]
          employee_id: string
          expires_at: string | null
          id: string
          location_id: string
          notes: string | null
          requested_by: string
          status: Database["public"]["Enums"]["i9_request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_types: Database["public"]["Enums"]["i9_document_type"][]
          employee_id: string
          expires_at?: string | null
          id?: string
          location_id: string
          notes?: string | null
          requested_by: string
          status?: Database["public"]["Enums"]["i9_request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_types?: Database["public"]["Enums"]["i9_document_type"][]
          employee_id?: string
          expires_at?: string | null
          id?: string
          location_id?: string
          notes?: string | null
          requested_by?: string
          status?: Database["public"]["Enums"]["i9_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "i9_document_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "i9_document_requests_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "i9_document_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      i9_documents: {
        Row: {
          deleted_at: string | null
          document_type: Database["public"]["Enums"]["i9_document_type"]
          employee_id: string
          file_name: string
          id: string
          request_id: string
          retrieved_at: string | null
          retrieved_by: string | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          deleted_at?: string | null
          document_type: Database["public"]["Enums"]["i9_document_type"]
          employee_id: string
          file_name: string
          id?: string
          request_id: string
          retrieved_at?: string | null
          retrieved_by?: string | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          deleted_at?: string | null
          document_type?: Database["public"]["Enums"]["i9_document_type"]
          employee_id?: string
          file_name?: string
          id?: string
          request_id?: string
          retrieved_at?: string | null
          retrieved_by?: string | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "i9_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "i9_documents_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "i9_document_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "i9_documents_retrieved_by_fkey"
            columns: ["retrieved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_audit_log: {
        Row: {
          count_id: string | null
          details: Json | null
          id: string
          logged_at: string
          operation: string
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          count_id?: string | null
          details?: Json | null
          id?: string
          logged_at?: string
          operation: string
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          count_id?: string | null
          details?: Json | null
          id?: string
          logged_at?: string
          operation?: string
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      inventory_count_deliveries: {
        Row: {
          count_id: string
          created_at: string
          id: string
          order_id: string
          order_type: string
          reconciled: boolean
          reconciled_at: string | null
          reconciled_by: string | null
        }
        Insert: {
          count_id: string
          created_at?: string
          id?: string
          order_id: string
          order_type: string
          reconciled?: boolean
          reconciled_at?: string | null
          reconciled_by?: string | null
        }
        Update: {
          count_id?: string
          created_at?: string
          id?: string
          order_id?: string
          order_type?: string
          reconciled?: boolean
          reconciled_at?: string | null
          reconciled_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_deliveries_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_edits: {
        Row: {
          count_item_id: string
          edited_at: string
          edited_by: string | null
          id: string
          new_quantity: number
          previous_quantity: number
          reason: string | null
        }
        Insert: {
          count_item_id: string
          edited_at?: string
          edited_by?: string | null
          id?: string
          new_quantity: number
          previous_quantity: number
          reason?: string | null
        }
        Update: {
          count_item_id?: string
          edited_at?: string
          edited_by?: string | null
          id?: string
          new_quantity?: number
          previous_quantity?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_edits_count_item_id_fkey"
            columns: ["count_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_count_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_edits_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_items: {
        Row: {
          count_id: string | null
          counted_at: string
          entered_cases: number | null
          entered_units: number | null
          id: string
          item_id: string | null
          quantity: number
          storage_location_id: string | null
          theoretical_quantity: number | null
          variance: number | null
          variance_cost: number | null
        }
        Insert: {
          count_id?: string | null
          counted_at?: string
          entered_cases?: number | null
          entered_units?: number | null
          id?: string
          item_id?: string | null
          quantity?: number
          storage_location_id?: string | null
          theoretical_quantity?: number | null
          variance?: number | null
          variance_cost?: number | null
        }
        Update: {
          count_id?: string | null
          counted_at?: string
          entered_cases?: number | null
          entered_units?: number | null
          id?: string
          item_id?: string | null
          quantity?: number
          storage_location_id?: string | null
          theoretical_quantity?: number | null
          variance?: number | null
          variance_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_items_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_items_storage_location_id_fkey"
            columns: ["storage_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          completed_at: string | null
          count_date: string
          counted_at: string | null
          counted_by: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          is_late_close: boolean
          late_close_notes: string | null
          location_id: string | null
          notes: string | null
          period_end_date: string | null
          period_type: string | null
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          count_date?: string
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_late_close?: boolean
          late_close_notes?: string | null
          location_id?: string | null
          notes?: string | null
          period_end_date?: string | null
          period_type?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          count_date?: string
          counted_at?: string | null
          counted_by?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_late_close?: boolean
          late_close_notes?: string | null
          location_id?: string | null
          notes?: string | null
          period_end_date?: string | null
          period_type?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_locations: {
        Row: {
          count_by: string
          created_at: string
          id: string
          item_id: string
          pack_quantity_override: number | null
          pan_enabled_keys: string[] | null
          storage_location_id: string
        }
        Insert: {
          count_by?: string
          created_at?: string
          id?: string
          item_id: string
          pack_quantity_override?: number | null
          pan_enabled_keys?: string[] | null
          storage_location_id: string
        }
        Update: {
          count_by?: string
          created_at?: string
          id?: string
          item_id?: string
          pack_quantity_override?: number | null
          pan_enabled_keys?: string[] | null
          storage_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_item_locations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_locations_storage_location_id_fkey"
            columns: ["storage_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          blended_price: number | null
          brand: string | null
          brand_item_id: string | null
          category: string | null
          common_name: string | null
          cost_per_unit: number | null
          count_unit: string | null
          count_units_per_case: number | null
          countable: boolean
          created_at: string
          display_order: number | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_daily_tracked: boolean
          is_recipe: boolean
          item_number: string | null
          last_synced_at: string | null
          linked_item_id: string | null
          location_id: string | null
          name: string
          pa_item_id: string | null
          pack_quantity: number | null
          pack_quantity_override: number | null
          pack_size: string | null
          pan_sizes: Json | null
          par_level: number | null
          qubeyond_item_id: string | null
          recipe_yield_qty: number | null
          recipe_yield_unit: string | null
          remap_status: string | null
          source: string | null
          storage_location_id: string | null
          unit: string
          updated_at: string
          user_hidden: boolean
          vendor_source: string | null
        }
        Insert: {
          blended_price?: number | null
          brand?: string | null
          brand_item_id?: string | null
          category?: string | null
          common_name?: string | null
          cost_per_unit?: number | null
          count_unit?: string | null
          count_units_per_case?: number | null
          countable?: boolean
          created_at?: string
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_daily_tracked?: boolean
          is_recipe?: boolean
          item_number?: string | null
          last_synced_at?: string | null
          linked_item_id?: string | null
          location_id?: string | null
          name: string
          pa_item_id?: string | null
          pack_quantity?: number | null
          pack_quantity_override?: number | null
          pack_size?: string | null
          pan_sizes?: Json | null
          par_level?: number | null
          qubeyond_item_id?: string | null
          recipe_yield_qty?: number | null
          recipe_yield_unit?: string | null
          remap_status?: string | null
          source?: string | null
          storage_location_id?: string | null
          unit?: string
          updated_at?: string
          user_hidden?: boolean
          vendor_source?: string | null
        }
        Update: {
          blended_price?: number | null
          brand?: string | null
          brand_item_id?: string | null
          category?: string | null
          common_name?: string | null
          cost_per_unit?: number | null
          count_unit?: string | null
          count_units_per_case?: number | null
          countable?: boolean
          created_at?: string
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_daily_tracked?: boolean
          is_recipe?: boolean
          item_number?: string | null
          last_synced_at?: string | null
          linked_item_id?: string | null
          location_id?: string | null
          name?: string
          pa_item_id?: string | null
          pack_quantity?: number | null
          pack_quantity_override?: number | null
          pack_size?: string | null
          pan_sizes?: Json | null
          par_level?: number | null
          qubeyond_item_id?: string | null
          recipe_yield_qty?: number | null
          recipe_yield_unit?: string | null
          remap_status?: string | null
          source?: string | null
          storage_location_id?: string | null
          unit?: string
          updated_at?: string
          user_hidden?: boolean
          vendor_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_brand_item_id_fkey"
            columns: ["brand_item_id"]
            isOneToOne: false
            referencedRelation: "brand_inventory_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_linked_item_id_fkey"
            columns: ["linked_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_storage_location_id_fkey"
            columns: ["storage_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          location_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          location_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          location_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_product_groups: {
        Row: {
          blueprint_id: string | null
          created_at: string
          description: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          location_id: string
          mapping_type: string
          name: string
          pos_categories: string[] | null
          pos_items: string[] | null
          reconciliation_group: string | null
          updated_at: string
        }
        Insert: {
          blueprint_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          location_id: string
          mapping_type?: string
          name: string
          pos_categories?: string[] | null
          pos_items?: string[] | null
          reconciliation_group?: string | null
          updated_at?: string
        }
        Update: {
          blueprint_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          location_id?: string
          mapping_type?: string
          name?: string
          pos_categories?: string[] | null
          pos_items?: string[] | null
          reconciliation_group?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_groups_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "recipe_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_product_groups_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_recipe_ingredients: {
        Row: {
          created_at: string
          id: string
          ingredient_item_id: string
          quantity: number
          recipe_item_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          id?: string
          ingredient_item_id: string
          quantity: number
          recipe_item_id: string
          unit?: string
        }
        Update: {
          created_at?: string
          id?: string
          ingredient_item_id?: string
          quantity?: number
          recipe_item_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_recipe_ingredients_ingredient_item_id_fkey"
            columns: ["ingredient_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_recipe_ingredients_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_schedule_settings: {
        Row: {
          created_at: string
          day_of_month: number | null
          day_of_week: number | null
          frequency: string
          id: string
          is_active: boolean
          location_id: string
          month_of_year: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          frequency?: string
          id?: string
          is_active?: boolean
          location_id: string
          month_of_year?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          frequency?: string
          id?: string
          is_active?: boolean
          location_id?: string
          month_of_year?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_schedule_settings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sync_logs: {
        Row: {
          completed_at: string | null
          errors: string[] | null
          id: string
          items_synced: number | null
          location_id: string
          metadata: Json | null
          orders_processed: number | null
          started_at: string
          status: string
          sync_source: string
          sync_type: string
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          errors?: string[] | null
          id?: string
          items_synced?: number | null
          location_id: string
          metadata?: Json | null
          orders_processed?: number | null
          started_at?: string
          status?: string
          sync_source: string
          sync_type?: string
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          errors?: string[] | null
          id?: string
          items_synced?: number | null
          location_id?: string
          metadata?: Json | null
          orders_processed?: number | null
          started_at?: string
          status?: string
          sync_source?: string
          sync_type?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sync_logs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_sync_logs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transfer_items: {
        Row: {
          cost_per_unit: number | null
          created_at: string
          id: string
          item_id: string
          quantity: number
          transfer_id: string
          unit_type: string
        }
        Insert: {
          cost_per_unit?: number | null
          created_at?: string
          id?: string
          item_id: string
          quantity?: number
          transfer_id: string
          unit_type?: string
        }
        Update: {
          cost_per_unit?: number | null
          created_at?: string
          id?: string
          item_id?: string
          quantity?: number
          transfer_id?: string
          unit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfer_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "inventory_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transfers: {
        Row: {
          created_at: string
          from_location_id: string
          id: string
          notes: string | null
          period_end_date: string | null
          received_at: string | null
          received_by: string | null
          status: string
          to_location_id: string
          transfer_date: string
          transferred_by: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_location_id: string
          id?: string
          notes?: string | null
          period_end_date?: string | null
          received_at?: string | null
          received_by?: string | null
          status?: string
          to_location_id: string
          transfer_date?: string
          transferred_by: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_location_id?: string
          id?: string
          notes?: string | null
          period_end_date?: string | null
          received_at?: string | null
          received_by?: string | null
          status?: string
          to_location_id?: string
          transfer_date?: string
          transferred_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfers_transferred_by_fkey"
            columns: ["transferred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_usage_rates: {
        Row: {
          calculated_from_period_end: string | null
          calculated_from_period_start: string | null
          created_at: string
          id: string
          inventory_item_id: string
          last_calculated_at: string | null
          location_id: string
          manual_override: boolean | null
          product_group_id: string
          rate_unit: string | null
          updated_at: string
          usage_rate: number | null
        }
        Insert: {
          calculated_from_period_end?: string | null
          calculated_from_period_start?: string | null
          created_at?: string
          id?: string
          inventory_item_id: string
          last_calculated_at?: string | null
          location_id: string
          manual_override?: boolean | null
          product_group_id: string
          rate_unit?: string | null
          updated_at?: string
          usage_rate?: number | null
        }
        Update: {
          calculated_from_period_end?: string | null
          calculated_from_period_start?: string | null
          created_at?: string
          id?: string
          inventory_item_id?: string
          last_calculated_at?: string | null
          location_id?: string
          manual_override?: boolean | null
          product_group_id?: string
          rate_unit?: string | null
          updated_at?: string
          usage_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_usage_rates_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_usage_rates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_usage_rates_product_group_id_fkey"
            columns: ["product_group_id"]
            isOneToOne: false
            referencedRelation: "inventory_product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_references: {
        Row: {
          application_id: string
          created_at: string
          display_order: number
          email: string | null
          id: string
          name: string
          phone: string | null
          relationship: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          display_order?: number
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          relationship?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          display_order?: number
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_application_references_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_template_questions: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_required: boolean
          options: Json | null
          question: string
          question_type: string
          template_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_required?: boolean
          options?: Json | null
          question: string
          question_type?: string
          template_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_required?: boolean
          options?: Json | null
          question?: string
          question_type?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_application_template_questions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "job_application_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_application_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_application_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_work_history: {
        Row: {
          application_id: string
          created_at: string
          display_order: number
          employer_name: string
          end_date: string | null
          id: string
          is_current: boolean | null
          job_title: string | null
          reason_for_leaving: string | null
          start_date: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          display_order?: number
          employer_name: string
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          job_title?: string | null
          reason_for_leaving?: string | null
          start_date?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          display_order?: number
          employer_name?: string
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          job_title?: string | null
          reason_for_leaving?: string | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_application_work_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          ai_analyzed_at: string | null
          ai_match: boolean | null
          ai_match_reason: string | null
          availability: Json
          custom_responses: Json | null
          email: string
          full_name: string
          id: string
          internal_notes: string | null
          interview_date: string | null
          interview_status: string | null
          interview_time: string | null
          location_id: string | null
          organization_id: string
          phone: string | null
          rejection_email_sent_at: string | null
          rejection_template_id: string | null
          resume_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["application_status"]
          submitted_at: string
          template_id: string
          updated_at: string
        }
        Insert: {
          ai_analyzed_at?: string | null
          ai_match?: boolean | null
          ai_match_reason?: string | null
          availability?: Json
          custom_responses?: Json | null
          email: string
          full_name: string
          id?: string
          internal_notes?: string | null
          interview_date?: string | null
          interview_status?: string | null
          interview_time?: string | null
          location_id?: string | null
          organization_id: string
          phone?: string | null
          rejection_email_sent_at?: string | null
          rejection_template_id?: string | null
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          ai_analyzed_at?: string | null
          ai_match?: boolean | null
          ai_match_reason?: string | null
          availability?: Json
          custom_responses?: Json | null
          email?: string
          full_name?: string
          id?: string
          internal_notes?: string | null
          interview_date?: string | null
          interview_status?: string | null
          interview_time?: string | null
          location_id?: string | null
          organization_id?: string
          phone?: string | null
          rejection_email_sent_at?: string | null
          rejection_template_id?: string | null
          resume_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_rejection_template_id_fkey"
            columns: ["rejection_template_id"]
            isOneToOne: false
            referencedRelation: "rejection_email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "job_application_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_cache: {
        Row: {
          avg_ticket_time: number | null
          created_at: string
          fetched_at: string
          id: string
          location_id: string
          metric_date: string
          orders_fast: number | null
          orders_medium: number | null
          orders_slow: number | null
          orders_total: number | null
        }
        Insert: {
          avg_ticket_time?: number | null
          created_at?: string
          fetched_at?: string
          id?: string
          location_id: string
          metric_date: string
          orders_fast?: number | null
          orders_medium?: number | null
          orders_slow?: number | null
          orders_total?: number | null
        }
        Update: {
          avg_ticket_time?: number | null
          created_at?: string
          fetched_at?: string
          id?: string
          location_id?: string
          metric_date?: string
          orders_fast?: number | null
          orders_medium?: number | null
          orders_slow?: number | null
          orders_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kds_cache_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_cache: {
        Row: {
          created_at: string
          double_time_hours: number | null
          employee_breakdown: Json | null
          fetched_at: string
          hourly_breakdown: Json | null
          id: string
          is_stale: boolean | null
          labor_cost: number | null
          labor_date: string
          labor_hours: number | null
          last_validated_at: string | null
          location_id: string
          overtime_hours: number | null
          regular_hours: number | null
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          double_time_hours?: number | null
          employee_breakdown?: Json | null
          fetched_at?: string
          hourly_breakdown?: Json | null
          id?: string
          is_stale?: boolean | null
          labor_cost?: number | null
          labor_date: string
          labor_hours?: number | null
          last_validated_at?: string | null
          location_id: string
          overtime_hours?: number | null
          regular_hours?: number | null
          source: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          double_time_hours?: number | null
          employee_breakdown?: Json | null
          fetched_at?: string
          hourly_breakdown?: Json | null
          id?: string
          is_stale?: boolean | null
          labor_cost?: number | null
          labor_date?: string
          labor_hours?: number | null
          last_validated_at?: string | null
          location_id?: string
          overtime_hours?: number | null
          regular_hours?: number | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "labor_cache_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_insights: {
        Row: {
          analysis: Json
          created_at: string
          dismissed_by: string[] | null
          id: string
          insight_date: string
          location_id: string
        }
        Insert: {
          analysis?: Json
          created_at?: string
          dismissed_by?: string[] | null
          id?: string
          insight_date: string
          location_id: string
        }
        Update: {
          analysis?: Json
          created_at?: string
          dismissed_by?: string[] | null
          id?: string
          insight_date?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labor_insights_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_rules: {
        Row: {
          allow_early_clock_in: boolean
          allow_unscheduled_clock_in: boolean
          auto_punch_out_time: string | null
          created_at: string | null
          daily_double_time_threshold: number | null
          daily_overtime_threshold: number | null
          double_time_multiplier: number | null
          early_clock_in_minutes: number
          id: string
          location_id: string
          meal_break_duration: number | null
          meal_break_hours: number | null
          overtime_multiplier: number | null
          pay_period_start_date: string | null
          pay_period_type: string
          rest_break_duration: number | null
          rest_break_hours: number | null
          rule_name: string
          state_code: string | null
          updated_at: string | null
          weekly_overtime_threshold: number | null
        }
        Insert: {
          allow_early_clock_in?: boolean
          allow_unscheduled_clock_in?: boolean
          auto_punch_out_time?: string | null
          created_at?: string | null
          daily_double_time_threshold?: number | null
          daily_overtime_threshold?: number | null
          double_time_multiplier?: number | null
          early_clock_in_minutes?: number
          id?: string
          location_id: string
          meal_break_duration?: number | null
          meal_break_hours?: number | null
          overtime_multiplier?: number | null
          pay_period_start_date?: string | null
          pay_period_type?: string
          rest_break_duration?: number | null
          rest_break_hours?: number | null
          rule_name: string
          state_code?: string | null
          updated_at?: string | null
          weekly_overtime_threshold?: number | null
        }
        Update: {
          allow_early_clock_in?: boolean
          allow_unscheduled_clock_in?: boolean
          auto_punch_out_time?: string | null
          created_at?: string | null
          daily_double_time_threshold?: number | null
          daily_overtime_threshold?: number | null
          double_time_multiplier?: number | null
          early_clock_in_minutes?: number
          id?: string
          location_id?: string
          meal_break_duration?: number | null
          meal_break_hours?: number | null
          overtime_multiplier?: number | null
          pay_period_start_date?: string | null
          pay_period_type?: string
          rest_break_duration?: number | null
          rest_break_hours?: number | null
          rule_name?: string
          state_code?: string | null
          updated_at?: string | null
          weekly_overtime_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "labor_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_hours: {
        Row: {
          close_time: string | null
          created_at: string
          day_of_week: number
          id: string
          is_closed: boolean
          location_id: string
          open_time: string | null
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_closed?: boolean
          location_id: string
          open_time?: string | null
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean
          location_id?: string
          open_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_hours_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_integrations: {
        Row: {
          backfill_completed_at: string | null
          backfill_days_completed: number | null
          backfill_error: string | null
          backfill_started_at: string | null
          backfill_status: string | null
          cached_token_gw: string | null
          created_at: string
          credentials: Json
          id: string
          integration_type: string
          is_active: boolean
          location_id: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          backfill_completed_at?: string | null
          backfill_days_completed?: number | null
          backfill_error?: string | null
          backfill_started_at?: string | null
          backfill_status?: string | null
          cached_token_gw?: string | null
          created_at?: string
          credentials?: Json
          id?: string
          integration_type: string
          is_active?: boolean
          location_id: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          backfill_completed_at?: string | null
          backfill_days_completed?: number | null
          backfill_error?: string | null
          backfill_started_at?: string | null
          backfill_status?: string | null
          cached_token_gw?: string | null
          created_at?: string
          credentials?: Json
          id?: string
          integration_type?: string
          is_active?: boolean
          location_id?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_integrations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_settings: {
        Row: {
          am_safe_count_window_minutes: number
          average_pizza_price: number | null
          birthday_events_enabled: boolean | null
          blackout_dates: string[] | null
          created_at: string
          drawer_bank: number
          drawer_count_notifications_enabled: boolean
          hours_close: string | null
          hours_open: string | null
          id: string
          inventory_period_cutoff: string
          inventory_period_end_day: number
          labor_percentage_target: number | null
          location_id: string
          pizza_sales_percentage: number | null
          pm_safe_count_window_minutes: number
          punch_clock_background_url: string | null
          punch_clock_overlay_text: string | null
          punch_clock_text_color: string | null
          punch_clock_text_shadow: boolean | null
          safe_count_notifications_enabled: boolean
          safe_target: number
          team_member_sales_view_enabled: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          am_safe_count_window_minutes?: number
          average_pizza_price?: number | null
          birthday_events_enabled?: boolean | null
          blackout_dates?: string[] | null
          created_at?: string
          drawer_bank?: number
          drawer_count_notifications_enabled?: boolean
          hours_close?: string | null
          hours_open?: string | null
          id?: string
          inventory_period_cutoff?: string
          inventory_period_end_day?: number
          labor_percentage_target?: number | null
          location_id: string
          pizza_sales_percentage?: number | null
          pm_safe_count_window_minutes?: number
          punch_clock_background_url?: string | null
          punch_clock_overlay_text?: string | null
          punch_clock_text_color?: string | null
          punch_clock_text_shadow?: boolean | null
          safe_count_notifications_enabled?: boolean
          safe_target?: number
          team_member_sales_view_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          am_safe_count_window_minutes?: number
          average_pizza_price?: number | null
          birthday_events_enabled?: boolean | null
          blackout_dates?: string[] | null
          created_at?: string
          drawer_bank?: number
          drawer_count_notifications_enabled?: boolean
          hours_close?: string | null
          hours_open?: string | null
          id?: string
          inventory_period_cutoff?: string
          inventory_period_end_day?: number
          labor_percentage_target?: number | null
          location_id?: string
          pizza_sales_percentage?: number | null
          pm_safe_count_window_minutes?: number
          punch_clock_background_url?: string | null
          punch_clock_overlay_text?: string | null
          punch_clock_text_color?: string | null
          punch_clock_text_shadow?: boolean | null
          safe_count_notifications_enabled?: boolean
          safe_target?: number
          team_member_sales_view_enabled?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_settings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          fresh_kds_location_id: string | null
          id: string
          is_active: boolean
          latitude: number | null
          location_code: string | null
          location_type: string
          longitude: number | null
          name: string
          organization_id: string | null
          store_number: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          fresh_kds_location_id?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          location_code?: string | null
          location_type?: string
          longitude?: number | null
          name: string
          organization_id?: string | null
          store_number?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          fresh_kds_location_id?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          location_code?: string | null
          location_type?: string
          longitude?: number | null
          name?: string
          organization_id?: string | null
          store_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      logbook_audit: {
        Row: {
          action: string
          created_at: string
          employee_id: string
          employee_name: string | null
          entry_id: string
          entry_title: string | null
          entry_type: string
          id: string
          location_id: string | null
          metadata: Json | null
          performed_by: string | null
          performed_by_name: string | null
          reason: string | null
        }
        Insert: {
          action: string
          created_at?: string
          employee_id: string
          employee_name?: string | null
          entry_id: string
          entry_title?: string | null
          entry_type?: string
          id?: string
          location_id?: string | null
          metadata?: Json | null
          performed_by?: string | null
          performed_by_name?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          employee_id?: string
          employee_name?: string | null
          entry_id?: string
          entry_title?: string | null
          entry_type?: string
          id?: string
          location_id?: string | null
          metadata?: Json | null
          performed_by?: string | null
          performed_by_name?: string | null
          reason?: string | null
        }
        Relationships: []
      }
      logbook_categories: {
        Row: {
          alert_enabled: boolean
          created_at: string
          created_by: string | null
          display_order: number
          id: string
          is_active: boolean
          location_id: string | null
          name: string
          push_notification_enabled: boolean
          updated_at: string
        }
        Insert: {
          alert_enabled?: boolean
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          location_id?: string | null
          name: string
          push_notification_enabled?: boolean
          updated_at?: string
        }
        Update: {
          alert_enabled?: boolean
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          location_id?: string | null
          name?: string
          push_notification_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logbook_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_categories_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      logbook_entries: {
        Row: {
          category_id: string
          created_at: string
          created_by: string
          entry_date: string
          followup_completed_at: string | null
          followup_completed_by: string | null
          id: string
          location_id: string | null
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          created_by: string
          entry_date: string
          followup_completed_at?: string | null
          followup_completed_by?: string | null
          id?: string
          location_id?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          created_by?: string
          entry_date?: string
          followup_completed_at?: string | null
          followup_completed_by?: string | null
          id?: string
          location_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "logbook_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "logbook_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_entries_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      logbook_entry_values: {
        Row: {
          attachment_url: string | null
          created_at: string
          entry_id: string
          field_id: string
          id: string
          value_date: string | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          entry_id: string
          field_id: string
          id?: string
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          entry_id?: string
          field_id?: string
          id?: string
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logbook_entry_values_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "logbook_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logbook_entry_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "logbook_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      logbook_fields: {
        Row: {
          category_id: string
          created_at: string
          display_order: number
          field_name: string
          field_type: string
          id: string
          is_required: boolean
          options: Json | null
        }
        Insert: {
          category_id: string
          created_at?: string
          display_order?: number
          field_name: string
          field_type: string
          id?: string
          is_required?: boolean
          options?: Json | null
        }
        Update: {
          category_id?: string
          created_at?: string
          display_order?: number
          field_name?: string
          field_type?: string
          id?: string
          is_required?: boolean
          options?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "logbook_fields_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "logbook_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          location_id: string
          retry_count: number
          started_at: string | null
          status: string
          target_date: string
          task_type: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          location_id: string
          retry_count?: number
          started_at?: string | null
          status?: string
          target_date: string
          task_type: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          location_id?: string
          retry_count?: number
          started_at?: string | null
          status?: string
          target_date?: string
          task_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_queue_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_task_logs: {
        Row: {
          completed_at: string
          details: Json | null
          id: string
          run_date: string
          status: string
          task_name: string
        }
        Insert: {
          completed_at?: string
          details?: Json | null
          id?: string
          run_date: string
          status?: string
          task_name: string
        }
        Update: {
          completed_at?: string
          details?: Json | null
          id?: string
          run_date?: string
          status?: string
          task_name?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          id: string
          message_id: string
          reaction: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          reaction: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          reaction?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_read_receipts: {
        Row: {
          id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          id?: string
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          id?: string
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_read_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_read_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          chat_id: string
          content: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_deleted_for_everyone: boolean
          parent_message_id: string | null
          scheduled_at: string | null
          sender_id: string
          updated_at: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          chat_id: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted_for_everyone?: boolean
          parent_message_id?: string | null
          scheduled_at?: string | null
          sender_id: string
          updated_at?: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          chat_id?: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted_for_everyone?: boolean
          parent_message_id?: string | null
          scheduled_at?: string | null
          sender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          announcements: boolean
          arcade_scores: boolean
          certification_expiring: boolean
          chat_messages: boolean
          created_at: string
          id: string
          late_arrivals: boolean
          overdue_checklists: boolean
          schedule_updates: boolean
          shift_approvals: boolean
          support_tickets: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          announcements?: boolean
          arcade_scores?: boolean
          certification_expiring?: boolean
          chat_messages?: boolean
          created_at?: string
          id?: string
          late_arrivals?: boolean
          overdue_checklists?: boolean
          schedule_updates?: boolean
          shift_approvals?: boolean
          support_tickets?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          announcements?: boolean
          arcade_scores?: boolean
          certification_expiring?: boolean
          chat_messages?: boolean
          created_at?: string
          id?: string
          late_arrivals?: boolean
          overdue_checklists?: boolean
          schedule_updates?: boolean
          shift_approvals?: boolean
          support_tickets?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          org_role: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_role?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_role?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_positions: {
        Row: {
          created_at: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_positions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          brand_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          brand_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ovation_integrations: {
        Row: {
          auth_token: string | null
          brand_id: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean | null
          token_updated_at: string | null
          updated_at: string
        }
        Insert: {
          auth_token?: string | null
          brand_id?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          token_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          auth_token?: string | null
          brand_id?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          token_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ovation_integrations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      ovation_location_mappings: {
        Row: {
          created_at: string
          id: string
          location_id: string | null
          ovation_location_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id?: string | null
          ovation_location_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string | null
          ovation_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ovation_location_mappings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pa_orders: {
        Row: {
          bound_to_count_id: string | null
          created_at: string
          delivery_date: string | null
          id: string
          items: Json | null
          location_id: string
          order_date: string
          order_number: string | null
          pa_order_id: string
          raw_data: Json | null
          status: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          bound_to_count_id?: string | null
          created_at?: string
          delivery_date?: string | null
          id?: string
          items?: Json | null
          location_id: string
          order_date: string
          order_number?: string | null
          pa_order_id: string
          raw_data?: Json | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          bound_to_count_id?: string | null
          created_at?: string
          delivery_date?: string | null
          id?: string
          items?: Json | null
          location_id?: string
          order_date?: string
          order_number?: string | null
          pa_order_id?: string
          raw_data?: Json | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pa_orders_bound_to_count_id_fkey"
            columns: ["bound_to_count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pa_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          end_date: string
          id: string
          start_date: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_date: string
          id?: string
          start_date: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_date?: string
          id?: string
          start_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_review_items: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          location_id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          location_id: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          location_id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_review_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_review_ratings: {
        Row: {
          created_at: string
          id: string
          image_urls: Json | null
          images: Json | null
          item_id: string
          notes: string | null
          photo_urls: Json | null
          rating: number
          review_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_urls?: Json | null
          images?: Json | null
          item_id: string
          notes?: string | null
          photo_urls?: Json | null
          rating: number
          review_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_urls?: Json | null
          images?: Json | null
          item_id?: string
          notes?: string | null
          photo_urls?: Json | null
          rating?: number
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_review_ratings_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "performance_review_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_review_ratings_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "performance_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_reviews: {
        Row: {
          created_at: string
          created_by: string
          employee_id: string
          follow_up_notes: string | null
          id: string
          location_id: string
          next_review_event_id: string | null
          next_review_scheduled_at: string | null
          review_period_end: string | null
          review_period_start: string | null
          schedule_event_id: string | null
          signature_url: string | null
          signed_at: string | null
          task_id: string | null
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          employee_id: string
          follow_up_notes?: string | null
          id?: string
          location_id: string
          next_review_event_id?: string | null
          next_review_scheduled_at?: string | null
          review_period_end?: string | null
          review_period_start?: string | null
          schedule_event_id?: string | null
          signature_url?: string | null
          signed_at?: string | null
          task_id?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          employee_id?: string
          follow_up_notes?: string | null
          id?: string
          location_id?: string
          next_review_event_id?: string | null
          next_review_scheduled_at?: string | null
          review_period_end?: string | null
          review_period_start?: string | null
          schedule_event_id?: string | null
          signature_url?: string | null
          signed_at?: string | null
          task_id?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_reviews_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_schedule_event_id_fkey"
            columns: ["schedule_event_id"]
            isOneToOne: false
            referencedRelation: "schedule_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      pfg_orders: {
        Row: {
          bound_to_count_id: string | null
          created_at: string
          delivery_date: string | null
          id: string
          items: Json | null
          location_id: string
          order_date: string
          order_number: string | null
          pfg_order_id: string
          raw_data: Json | null
          status: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          bound_to_count_id?: string | null
          created_at?: string
          delivery_date?: string | null
          id?: string
          items?: Json | null
          location_id: string
          order_date: string
          order_number?: string | null
          pfg_order_id: string
          raw_data?: Json | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          bound_to_count_id?: string | null
          created_at?: string
          delivery_date?: string | null
          id?: string
          items?: Json | null
          location_id?: string
          order_date?: string
          order_number?: string | null
          pfg_order_id?: string
          raw_data?: Json | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pfg_orders_bound_to_count_id_fkey"
            columns: ["bound_to_count_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pfg_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          all_locations_enabled: boolean
          app_version: string | null
          appears_on_schedule: boolean
          birthday: string | null
          created_at: string | null
          croo_cash_balance: number
          default_location_id: string | null
          display_order: number | null
          email: string
          employee_pin: string | null
          first_login_at: string | null
          full_name: string | null
          hourly_wage: number | null
          id: string
          invited_by: string | null
          is_active: boolean | null
          last_login_at: string | null
          max_weekly_hours: number | null
          min_weekly_hours: number | null
          nickname: string | null
          phone_number: string | null
          profile_photo_url: string | null
          role: string | null
          updated_at: string | null
          weekly_availability: Json | null
        }
        Insert: {
          all_locations_enabled?: boolean
          app_version?: string | null
          appears_on_schedule?: boolean
          birthday?: string | null
          created_at?: string | null
          croo_cash_balance?: number
          default_location_id?: string | null
          display_order?: number | null
          email: string
          employee_pin?: string | null
          first_login_at?: string | null
          full_name?: string | null
          hourly_wage?: number | null
          id: string
          invited_by?: string | null
          is_active?: boolean | null
          last_login_at?: string | null
          max_weekly_hours?: number | null
          min_weekly_hours?: number | null
          nickname?: string | null
          phone_number?: string | null
          profile_photo_url?: string | null
          role?: string | null
          updated_at?: string | null
          weekly_availability?: Json | null
        }
        Update: {
          all_locations_enabled?: boolean
          app_version?: string | null
          appears_on_schedule?: boolean
          birthday?: string | null
          created_at?: string | null
          croo_cash_balance?: number
          default_location_id?: string | null
          display_order?: number | null
          email?: string
          employee_pin?: string | null
          first_login_at?: string | null
          full_name?: string | null
          hourly_wage?: number | null
          id?: string
          invited_by?: string | null
          is_active?: boolean | null
          last_login_at?: string | null
          max_weekly_hours?: number | null
          min_weekly_hours?: number | null
          nickname?: string | null
          phone_number?: string | null
          profile_photo_url?: string | null
          role?: string | null
          updated_at?: string | null
          weekly_availability?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_location_id_fkey"
            columns: ["default_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_clock_attempts: {
        Row: {
          attempt_time: string
          created_at: string
          guessed_user_ids: string[] | null
          guessed_user_names: string[] | null
          id: string
          location_id: string | null
          matched_user_id: string | null
          pin_entered: string
          success: boolean
        }
        Insert: {
          attempt_time?: string
          created_at?: string
          guessed_user_ids?: string[] | null
          guessed_user_names?: string[] | null
          id?: string
          location_id?: string | null
          matched_user_id?: string | null
          pin_entered: string
          success?: boolean
        }
        Update: {
          attempt_time?: string
          created_at?: string
          guessed_user_ids?: string[] | null
          guessed_user_names?: string[] | null
          id?: string
          location_id?: string | null
          matched_user_id?: string | null
          pin_entered?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "punch_clock_attempts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_clock_attempts_matched_user_id_fkey"
            columns: ["matched_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      punch_clock_templates: {
        Row: {
          background_url: string | null
          background_urls: Json | null
          created_at: string
          created_by: string | null
          end_at: string
          id: string
          is_active: boolean | null
          location_id: string
          name: string
          overlay_text: string | null
          overlay_texts: Json | null
          slide_duration: number | null
          start_at: string
          text_color: string | null
          text_position: string | null
          text_shadow: boolean | null
          updated_at: string
        }
        Insert: {
          background_url?: string | null
          background_urls?: Json | null
          created_at?: string
          created_by?: string | null
          end_at: string
          id?: string
          is_active?: boolean | null
          location_id: string
          name: string
          overlay_text?: string | null
          overlay_texts?: Json | null
          slide_duration?: number | null
          start_at: string
          text_color?: string | null
          text_position?: string | null
          text_shadow?: boolean | null
          updated_at?: string
        }
        Update: {
          background_url?: string | null
          background_urls?: Json | null
          created_at?: string
          created_by?: string | null
          end_at?: string
          id?: string
          is_active?: boolean | null
          location_id?: string
          name?: string
          overlay_text?: string | null
          overlay_texts?: Json | null
          slide_duration?: number | null
          start_at?: string
          text_color?: string | null
          text_position?: string | null
          text_shadow?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "punch_clock_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "punch_clock_templates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notification_tokens: {
        Row: {
          created_at: string
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      qr_task_reports: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          guest_note: string | null
          id: string
          location_id: string
          reported_at: string
          reporter_ip: string | null
          selected_issues: string[]
          task_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          guest_note?: string | null
          id?: string
          location_id: string
          reported_at?: string
          reporter_ip?: string | null
          selected_issues?: string[]
          task_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          guest_note?: string | null
          id?: string
          location_id?: string
          reported_at?: string
          reporter_ip?: string | null
          selected_issues?: string[]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_task_reports_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_task_reports_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_task_reports_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_task_templates: {
        Row: {
          accent_color: string
          alarm_end_time: string | null
          alarm_start_time: string | null
          assignment_type: string | null
          created_at: string
          created_by: string | null
          custom_times: string[] | null
          days_of_week: number[] | null
          default_duration: string | null
          default_roles: string[] | null
          description: string | null
          frequency_minutes: number | null
          frequency_type: string | null
          id: string
          is_qr_triggered: boolean | null
          location_id: string | null
          name: string
          notify_only_working: boolean | null
          push_enabled: boolean | null
          qr_allow_notes: boolean | null
          qr_issue_options: string[] | null
          qr_notify_punch_clock: boolean | null
          show_on_dashboard: boolean | null
          show_on_punch_clock: boolean | null
          subtasks: Json | null
          task_style: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          alarm_end_time?: string | null
          alarm_start_time?: string | null
          assignment_type?: string | null
          created_at?: string
          created_by?: string | null
          custom_times?: string[] | null
          days_of_week?: number[] | null
          default_duration?: string | null
          default_roles?: string[] | null
          description?: string | null
          frequency_minutes?: number | null
          frequency_type?: string | null
          id?: string
          is_qr_triggered?: boolean | null
          location_id?: string | null
          name: string
          notify_only_working?: boolean | null
          push_enabled?: boolean | null
          qr_allow_notes?: boolean | null
          qr_issue_options?: string[] | null
          qr_notify_punch_clock?: boolean | null
          show_on_dashboard?: boolean | null
          show_on_punch_clock?: boolean | null
          subtasks?: Json | null
          task_style?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          alarm_end_time?: string | null
          alarm_start_time?: string | null
          assignment_type?: string | null
          created_at?: string
          created_by?: string | null
          custom_times?: string[] | null
          days_of_week?: number[] | null
          default_duration?: string | null
          default_roles?: string[] | null
          description?: string | null
          frequency_minutes?: number | null
          frequency_type?: string | null
          id?: string
          is_qr_triggered?: boolean | null
          location_id?: string | null
          name?: string
          notify_only_working?: boolean | null
          push_enabled?: boolean | null
          qr_allow_notes?: boolean | null
          qr_issue_options?: string[] | null
          qr_notify_punch_clock?: boolean | null
          show_on_dashboard?: boolean | null
          show_on_punch_clock?: boolean | null
          subtasks?: Json | null
          task_style?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_task_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_task_templates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      read_and_sign_assignments: {
        Row: {
          assigned_at: string
          document_id: string
          employee_id: string
          id: string
          signature_url: string | null
          signed_at: string | null
          task_id: string | null
        }
        Insert: {
          assigned_at?: string
          document_id: string
          employee_id: string
          id?: string
          signature_url?: string | null
          signed_at?: string | null
          task_id?: string | null
        }
        Update: {
          assigned_at?: string
          document_id?: string
          employee_id?: string
          id?: string
          signature_url?: string | null
          signed_at?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "read_and_sign_assignments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "read_and_sign_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_and_sign_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_and_sign_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      read_and_sign_documents: {
        Row: {
          attachment_name: string | null
          attachment_url: string | null
          attachments: Json | null
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          list_style: string
          location_id: string
          revised_at: string | null
          revised_by: string | null
          revision_number: number
          scheduled_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_url?: string | null
          attachments?: Json | null
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          list_style?: string
          location_id: string
          revised_at?: string | null
          revised_by?: string | null
          revision_number?: number
          scheduled_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          attachment_name?: string | null
          attachment_url?: string | null
          attachments?: Json | null
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          list_style?: string
          location_id?: string
          revised_at?: string | null
          revised_by?: string | null
          revision_number?: number
          scheduled_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "read_and_sign_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_and_sign_documents_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_and_sign_documents_revised_by_fkey"
            columns: ["revised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      read_and_sign_item_checks: {
        Row: {
          assignment_id: string
          checked_at: string
          id: string
          item_id: string
        }
        Insert: {
          assignment_id: string
          checked_at?: string
          id?: string
          item_id: string
        }
        Update: {
          assignment_id?: string
          checked_at?: string
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "read_and_sign_item_checks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "read_and_sign_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_and_sign_item_checks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "read_and_sign_items"
            referencedColumns: ["id"]
          },
        ]
      }
      read_and_sign_items: {
        Row: {
          content: string
          created_at: string
          document_id: string
          id: string
          order_index: number
          parent_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          document_id: string
          id?: string
          order_index?: number
          parent_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          document_id?: string
          id?: string
          order_index?: number
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "read_and_sign_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "read_and_sign_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_and_sign_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "read_and_sign_items"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_blueprint_ingredients: {
        Row: {
          blueprint_id: string
          created_at: string
          id: string
          ingredient_type: string
          quantity: number
          source_name: string | null
          sub_blueprint_id: string | null
          unit: string | null
          vendor_item_id: string | null
        }
        Insert: {
          blueprint_id: string
          created_at?: string
          id?: string
          ingredient_type?: string
          quantity: number
          source_name?: string | null
          sub_blueprint_id?: string | null
          unit?: string | null
          vendor_item_id?: string | null
        }
        Update: {
          blueprint_id?: string
          created_at?: string
          id?: string
          ingredient_type?: string
          quantity?: number
          source_name?: string | null
          sub_blueprint_id?: string | null
          unit?: string | null
          vendor_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_blueprint_ingredients_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "recipe_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_blueprint_ingredients_sub_blueprint_id_fkey"
            columns: ["sub_blueprint_id"]
            isOneToOne: false
            referencedRelation: "recipe_blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_blueprint_ingredients_vendor_item_id_fkey"
            columns: ["vendor_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_blueprints: {
        Row: {
          brand_id: string | null
          catalog_section: string | null
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          location_id: string | null
          name: string
          produces_item_id: string | null
          r365_name: string | null
          source: string | null
          updated_at: string
          yield_qty: number | null
          yield_unit: string | null
        }
        Insert: {
          brand_id?: string | null
          catalog_section?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name: string
          produces_item_id?: string | null
          r365_name?: string | null
          source?: string | null
          updated_at?: string
          yield_qty?: number | null
          yield_unit?: string | null
        }
        Update: {
          brand_id?: string | null
          catalog_section?: string | null
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name?: string
          produces_item_id?: string | null
          r365_name?: string | null
          source?: string | null
          updated_at?: string
          yield_qty?: number | null
          yield_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_blueprints_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_blueprints_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_blueprints_produces_item_id_fkey"
            columns: ["produces_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      rejection_email_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rejection_email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_dashboard_cubes: {
        Row: {
          created_at: string
          created_by: string | null
          cubes: Json
          id: string
          organization_id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cubes?: Json
          id?: string
          organization_id: string
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cubes?: Json
          id?: string
          organization_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_dashboard_cubes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_dashboard_cubes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_notification_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          notification_label: string
          notification_type: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          notification_label: string
          notification_type: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          notification_label?: string
          notification_type?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          permission_key: string
          permission_label: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          permission_key: string
          permission_label: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          permission_key?: string
          permission_label?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      sales_aggregates: {
        Row: {
          aggregate_type: string
          avg_daily_sales: number | null
          created_at: string
          days_with_sales: number
          guest_count: number
          id: string
          location_id: string
          net_sales: number
          period_end: string
          period_start: string
          pizza_count: number
          updated_at: string
        }
        Insert: {
          aggregate_type: string
          avg_daily_sales?: number | null
          created_at?: string
          days_with_sales?: number
          guest_count?: number
          id?: string
          location_id: string
          net_sales?: number
          period_end: string
          period_start: string
          pizza_count?: number
          updated_at?: string
        }
        Update: {
          aggregate_type?: string
          avg_daily_sales?: number | null
          created_at?: string
          days_with_sales?: number
          guest_count?: number
          id?: string
          location_id?: string
          net_sales?: number
          period_end?: string
          period_start?: string
          pizza_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_aggregates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_cache: {
        Row: {
          avg_ticket: number | null
          created_at: string
          fetched_at: string
          flagged_no_sales: boolean | null
          guest_count: number
          hourly_data: Json | null
          id: string
          initial_projection: number | null
          living_projection: number | null
          location_id: string
          net_sales: number
          override_at: string | null
          override_by: string | null
          override_projection: number | null
          payments_data: Json | null
          pizza_count: number
          product_mix: Json | null
          projected_sales: number | null
          sale_date: string
          validation_attempts: number | null
          validation_status: string | null
          yoy_hourly_data: Json | null
          yoy_net_sales: number | null
          yoy_sale_date: string | null
        }
        Insert: {
          avg_ticket?: number | null
          created_at?: string
          fetched_at?: string
          flagged_no_sales?: boolean | null
          guest_count?: number
          hourly_data?: Json | null
          id?: string
          initial_projection?: number | null
          living_projection?: number | null
          location_id: string
          net_sales?: number
          override_at?: string | null
          override_by?: string | null
          override_projection?: number | null
          payments_data?: Json | null
          pizza_count?: number
          product_mix?: Json | null
          projected_sales?: number | null
          sale_date: string
          validation_attempts?: number | null
          validation_status?: string | null
          yoy_hourly_data?: Json | null
          yoy_net_sales?: number | null
          yoy_sale_date?: string | null
        }
        Update: {
          avg_ticket?: number | null
          created_at?: string
          fetched_at?: string
          flagged_no_sales?: boolean | null
          guest_count?: number
          hourly_data?: Json | null
          id?: string
          initial_projection?: number | null
          living_projection?: number | null
          location_id?: string
          net_sales?: number
          override_at?: string | null
          override_by?: string | null
          override_projection?: number | null
          payments_data?: Json | null
          pizza_count?: number
          product_mix?: Json | null
          projected_sales?: number | null
          sale_date?: string
          validation_attempts?: number | null
          validation_status?: string | null
          yoy_hourly_data?: Json | null
          yoy_net_sales?: number | null
          yoy_sale_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_cache_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_change_log: {
        Row: {
          change_type: string
          changed_by: string | null
          created_at: string
          id: string
          is_draft: boolean
          new_shift_data: Json | null
          old_shift_data: Json | null
          schedule_id: string
          user_id: string
        }
        Insert: {
          change_type: string
          changed_by?: string | null
          created_at?: string
          id?: string
          is_draft?: boolean
          new_shift_data?: Json | null
          old_shift_data?: Json | null
          schedule_id: string
          user_id: string
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          is_draft?: boolean
          new_shift_data?: Json | null
          old_shift_data?: Json | null
          schedule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_change_log_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_change_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_events: {
        Row: {
          category_id: string | null
          created_at: string | null
          day_of_week: number
          days_of_week: number[] | null
          event_date: string | null
          event_end_time: string | null
          event_name: string
          event_time: string
          id: string
          is_daily_task: boolean
          is_meeting: boolean
          is_recurring: boolean
          location_id: string | null
          notes: string | null
          schedule_id: string | null
          tagged_roles: Json | null
          visible_to_roles: string[] | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string | null
          day_of_week: number
          days_of_week?: number[] | null
          event_date?: string | null
          event_end_time?: string | null
          event_name: string
          event_time: string
          id?: string
          is_daily_task?: boolean
          is_meeting?: boolean
          is_recurring?: boolean
          location_id?: string | null
          notes?: string | null
          schedule_id?: string | null
          tagged_roles?: Json | null
          visible_to_roles?: string[] | null
        }
        Update: {
          category_id?: string | null
          created_at?: string | null
          day_of_week?: number
          days_of_week?: number[] | null
          event_date?: string | null
          event_end_time?: string | null
          event_name?: string
          event_time?: string
          id?: string
          is_daily_task?: boolean
          is_meeting?: boolean
          is_recurring?: boolean
          location_id?: string | null
          notes?: string | null
          schedule_id?: string | null
          tagged_roles?: Json | null
          visible_to_roles?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "event_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_projected_sales: {
        Row: {
          created_at: string
          day_of_week: number
          id: string
          projected_sales: number
          schedule_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          projected_sales?: number
          schedule_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          projected_sales?: number
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_projected_sales_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_shifts: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_time_off: boolean | null
          original_end_time: string | null
          schedule_id: string | null
          shift_date: string
          start_time: string
          template_id: string | null
          user_id: string | null
          was_trimmed: boolean | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_time_off?: boolean | null
          original_end_time?: string | null
          schedule_id?: string | null
          shift_date: string
          start_time: string
          template_id?: string | null
          user_id?: string | null
          was_trimmed?: boolean | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_time_off?: boolean | null
          original_end_time?: string | null
          schedule_id?: string | null
          shift_date?: string
          start_time?: string
          template_id?: string | null
          user_id?: string | null
          was_trimmed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_shifts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_published: boolean | null
          last_status_action: string | null
          last_status_changed_at: string | null
          last_status_changed_by: string | null
          location_id: string | null
          published_shifts_snapshot: Json | null
          published_snapshot: Json | null
          updated_at: string | null
          week_end_date: string
          week_start_date: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_published?: boolean | null
          last_status_action?: string | null
          last_status_changed_at?: string | null
          last_status_changed_by?: string | null
          location_id?: string | null
          published_shifts_snapshot?: Json | null
          published_snapshot?: Json | null
          updated_at?: string | null
          week_end_date: string
          week_start_date: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_published?: boolean | null
          last_status_action?: string | null
          last_status_changed_at?: string | null
          last_status_changed_by?: string | null
          location_id?: string | null
          published_shifts_snapshot?: Json | null
          published_snapshot?: Json | null
          updated_at?: string | null
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_offer_claims: {
        Row: {
          created_at: string
          id: string
          shift_offer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          shift_offer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          shift_offer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_offer_claims_shift_offer_id_fkey"
            columns: ["shift_offer_id"]
            isOneToOne: false
            referencedRelation: "shift_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_offer_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_offers: {
        Row: {
          claimed_by_user_id: string | null
          created_at: string
          id: string
          offered_by_user_id: string
          shift_id: string
          status: string
          updated_at: string
        }
        Insert: {
          claimed_by_user_id?: string | null
          created_at?: string
          id?: string
          offered_by_user_id: string
          shift_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          claimed_by_user_id?: string | null
          created_at?: string
          id?: string
          offered_by_user_id?: string
          shift_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_offers_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_offers_offered_by_user_id_fkey"
            columns: ["offered_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_offers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "scheduled_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          allowed_roles: string[] | null
          color: string | null
          created_at: string | null
          created_by: string | null
          days_of_week: number[] | null
          end_time: string
          id: string
          location_id: string | null
          position: string | null
          role: Database["public"]["Enums"]["app_role"]
          start_time: string
          template_name: string
        }
        Insert: {
          allowed_roles?: string[] | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week?: number[] | null
          end_time: string
          id?: string
          location_id?: string | null
          position?: string | null
          role: Database["public"]["Enums"]["app_role"]
          start_time: string
          template_name: string
        }
        Update: {
          allowed_roles?: string[] | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week?: number[] | null
          end_time?: string
          id?: string
          location_id?: string | null
          position?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          start_time?: string
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_templates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          image_url: string | null
          sender_id: string
          ticket_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          sender_id: string
          ticket_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: Database["public"]["Enums"]["support_ticket_category"]
          created_at: string
          description: string
          id: string
          occurrence_time: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          screenshot_url: string | null
          status: Database["public"]["Enums"]["support_ticket_status"]
          ticket_number: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["support_ticket_category"]
          created_at?: string
          description: string
          id?: string
          occurrence_time?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screenshot_url?: string | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          ticket_number?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["support_ticket_category"]
          created_at?: string
          description?: string
          id?: string
          occurrence_time?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          screenshot_url?: string | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          ticket_number?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_subtask_completions: {
        Row: {
          completed_at: string
          completed_by: string
          completed_date: string
          id: string
          subtask_id: string
          task_id: string
        }
        Insert: {
          completed_at?: string
          completed_by: string
          completed_date: string
          id?: string
          subtask_id: string
          task_id: string
        }
        Update: {
          completed_at?: string
          completed_by?: string
          completed_date?: string
          id?: string
          subtask_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_subtask_completions_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_subtask_completions_subtask_id_fkey"
            columns: ["subtask_id"]
            isOneToOne: false
            referencedRelation: "temporary_task_subtasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_subtask_completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      temporary_task_assignments: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"] | null
          task_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          task_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          task_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "temporary_task_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporary_task_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      temporary_task_subtasks: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          days_of_week: number[] | null
          id: string
          item_type: string
          order_index: number
          quantity: number | null
          response_image_url: string | null
          task_id: string
          title: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          days_of_week?: number[] | null
          id?: string
          item_type?: string
          order_index?: number
          quantity?: number | null
          response_image_url?: string | null
          task_id: string
          title: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          days_of_week?: number[] | null
          id?: string
          item_type?: string
          order_index?: number
          quantity?: number | null
          response_image_url?: string | null
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "temporary_task_subtasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporary_task_subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "temporary_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      temporary_tasks: {
        Row: {
          accent_color: string | null
          alarm_end_time: string | null
          alarm_start_time: string | null
          audit_id: string | null
          audit_item_index: number | null
          audit_priority_level: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          custom_times: string[] | null
          days_of_week: number[] | null
          description: string | null
          expires_at: string | null
          frequency_minutes: number | null
          frequency_type: string | null
          icon_name: string | null
          id: string
          is_active: boolean
          is_qr_triggered: boolean | null
          is_recurring: boolean
          last_triggered_at: string | null
          location_id: string
          notify_only_working: boolean
          push_enabled: boolean
          qr_allow_notes: boolean | null
          qr_code: string | null
          qr_issue_options: Json | null
          qr_notify_punch_clock: boolean | null
          shareable: boolean
          show_on_dashboard: boolean
          show_on_punch_clock: boolean | null
          task_style: string
          title: string
          write_up_id: string | null
        }
        Insert: {
          accent_color?: string | null
          alarm_end_time?: string | null
          alarm_start_time?: string | null
          audit_id?: string | null
          audit_item_index?: number | null
          audit_priority_level?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by: string
          custom_times?: string[] | null
          days_of_week?: number[] | null
          description?: string | null
          expires_at?: string | null
          frequency_minutes?: number | null
          frequency_type?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean
          is_qr_triggered?: boolean | null
          is_recurring?: boolean
          last_triggered_at?: string | null
          location_id: string
          notify_only_working?: boolean
          push_enabled?: boolean
          qr_allow_notes?: boolean | null
          qr_code?: string | null
          qr_issue_options?: Json | null
          qr_notify_punch_clock?: boolean | null
          shareable?: boolean
          show_on_dashboard?: boolean
          show_on_punch_clock?: boolean | null
          task_style?: string
          title: string
          write_up_id?: string | null
        }
        Update: {
          accent_color?: string | null
          alarm_end_time?: string | null
          alarm_start_time?: string | null
          audit_id?: string | null
          audit_item_index?: number | null
          audit_priority_level?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          custom_times?: string[] | null
          days_of_week?: number[] | null
          description?: string | null
          expires_at?: string | null
          frequency_minutes?: number | null
          frequency_type?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean
          is_qr_triggered?: boolean | null
          is_recurring?: boolean
          last_triggered_at?: string | null
          location_id?: string
          notify_only_working?: boolean
          push_enabled?: boolean
          qr_allow_notes?: boolean | null
          qr_code?: string | null
          qr_issue_options?: Json | null
          qr_notify_punch_clock?: boolean | null
          shareable?: boolean
          show_on_dashboard?: boolean
          show_on_punch_clock?: boolean | null
          task_style?: string
          title?: string
          write_up_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "temporary_tasks_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "food_safety_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporary_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporary_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporary_tasks_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "temporary_tasks_write_up_id_fkey"
            columns: ["write_up_id"]
            isOneToOne: false
            referencedRelation: "employee_writeups"
            referencedColumns: ["id"]
          },
        ]
      }
      time_punches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          edited_at: string | null
          edited_by: string | null
          has_break_violation: boolean
          has_extended_break: boolean
          has_overtime: boolean
          id: string
          is_auto_punched_out: boolean
          location_id: string | null
          notes: string | null
          punch_time: string
          punch_type: string
          shift_id: string | null
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          has_break_violation?: boolean
          has_extended_break?: boolean
          has_overtime?: boolean
          id?: string
          is_auto_punched_out?: boolean
          location_id?: string | null
          notes?: string | null
          punch_time?: string
          punch_type: string
          shift_id?: string | null
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          has_break_violation?: boolean
          has_extended_break?: boolean
          has_overtime?: boolean
          id?: string
          is_auto_punched_out?: boolean
          location_id?: string | null
          notes?: string | null
          punch_time?: string
          punch_type?: string
          shift_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_punches_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "scheduled_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_punches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_distributions: {
        Row: {
          created_at: string
          daily_tip_id: string
          distribution_type: string
          hours_worked: number
          id: string
          tip_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_tip_id: string
          distribution_type?: string
          hours_worked?: number
          id?: string
          tip_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_tip_id?: string
          distribution_type?: string
          hours_worked?: number
          id?: string
          tip_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_distributions_daily_tip_id_fkey"
            columns: ["daily_tip_id"]
            isOneToOne: false
            referencedRelation: "daily_tips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_distributions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dashboard_cubes: {
        Row: {
          accent_color: string | null
          created_at: string
          cube_type: string
          display_order: number
          face_metrics: Json | null
          face_titles: Json | null
          id: string
          location_id: string
          metrics: Json
          num_faces: number | null
          reference_id: string | null
          title: string | null
          updated_at: string
          user_id: string
          widget_size: string
        }
        Insert: {
          accent_color?: string | null
          created_at?: string
          cube_type?: string
          display_order?: number
          face_metrics?: Json | null
          face_titles?: Json | null
          id?: string
          location_id: string
          metrics?: Json
          num_faces?: number | null
          reference_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          widget_size?: string
        }
        Update: {
          accent_color?: string | null
          created_at?: string
          cube_type?: string
          display_order?: number
          face_metrics?: Json | null
          face_titles?: Json | null
          id?: string
          location_id?: string
          metrics?: Json
          num_faces?: number | null
          reference_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          widget_size?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_dashboard_cubes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dashboard_sections: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_visible: boolean
          location_id: string
          section_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          location_id: string
          section_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_visible?: boolean
          location_id?: string
          section_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_dashboard_sections_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_location_notifications: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          location_id: string
          notification_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          location_id: string
          notification_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          location_id?: string
          notification_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_location_notifications_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_locations: {
        Row: {
          created_at: string
          id: string
          location_id: string
          show_on_schedule: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          show_on_schedule?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          show_on_schedule?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notification_settings: {
        Row: {
          alert_enabled: boolean
          created_at: string
          email_enabled: boolean
          id: string
          location_id: string | null
          notification_type: string
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_enabled?: boolean
          created_at?: string
          email_enabled?: boolean
          id?: string
          location_id?: string | null
          notification_type: string
          push_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_enabled?: boolean
          created_at?: string
          email_enabled?: boolean
          id?: string
          location_id?: string | null
          notification_type?: string
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notification_settings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_signup_alerts: {
        Row: {
          created_at: string
          id: string
          signed_up_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          signed_up_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          signed_up_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_signup_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wage_history: {
        Row: {
          created_at: string | null
          created_by: string | null
          effective_date: string
          hourly_wage: number
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          effective_date: string
          hourly_wage: number
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          effective_date?: string
          hourly_wage?: number
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wage_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      week_template_assignments: {
        Row: {
          am_splh_goal: number | null
          created_at: string
          day_of_week: number
          id: string
          pm_splh_goal: number | null
          shift_template_id: string
          week_template_id: string
        }
        Insert: {
          am_splh_goal?: number | null
          created_at?: string
          day_of_week: number
          id?: string
          pm_splh_goal?: number | null
          shift_template_id: string
          week_template_id: string
        }
        Update: {
          am_splh_goal?: number | null
          created_at?: string
          day_of_week?: number
          id?: string
          pm_splh_goal?: number | null
          shift_template_id?: string
          week_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_template_assignments_shift_template_id_fkey"
            columns: ["shift_template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_template_assignments_week_template_id_fkey"
            columns: ["week_template_id"]
            isOneToOne: false
            referencedRelation: "week_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      week_template_day_settings: {
        Row: {
          created_at: string
          day_of_week: number
          id: string
          labor_percentage_target: number | null
          projected_sales: number | null
          updated_at: string
          week_template_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          id?: string
          labor_percentage_target?: number | null
          projected_sales?: number | null
          updated_at?: string
          week_template_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          id?: string
          labor_percentage_target?: number | null
          projected_sales?: number | null
          updated_at?: string
          week_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_template_day_settings_week_template_id_fkey"
            columns: ["week_template_id"]
            isOneToOne: false
            referencedRelation: "week_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      week_template_hourly_coverage: {
        Row: {
          created_at: string
          day_of_week: number
          hour: number
          id: string
          min_staff: number
          projected_sales: number | null
          updated_at: string
          week_template_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          hour: number
          id?: string
          min_staff?: number
          projected_sales?: number | null
          updated_at?: string
          week_template_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          hour?: number
          id?: string
          min_staff?: number
          projected_sales?: number | null
          updated_at?: string
          week_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_template_hourly_coverage_week_template_id_fkey"
            columns: ["week_template_id"]
            isOneToOne: false
            referencedRelation: "week_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      week_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          location_id: string | null
          target_weekly_hours: number | null
          template_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          location_id?: string | null
          target_weekly_hours?: number | null
          template_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          location_id?: string | null
          target_weekly_hours?: number | null
          template_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "week_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "week_templates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      applicant_current_flags: {
        Row: {
          application_id: string | null
          created_at: string | null
          flag_color: Database["public"]["Enums"]["applicant_flag_color"] | null
          reason: string | null
          set_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applicant_flags_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      assign_user_to_location: {
        Args: { p_location_id: string; p_user_id: string }
        Returns: undefined
      }
      can_manage_org_applications: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_rejection_templates: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      check_alerts_sql: { Args: never; Returns: undefined }
      convert_recipe_unit_to_count: {
        Args: { p_count_unit: string; p_recipe_unit: string }
        Returns: number
      }
      generate_location_code: { Args: never; Returns: string }
      generate_unique_pin: { Args: never; Returns: string }
      get_chat_unread_counts: {
        Args: { _location_id: string; _user_id: string }
        Returns: Json
      }
      get_current_wage: {
        Args: { p_date?: string; p_user_id: string }
        Returns: number
      }
      get_current_wages_batch: {
        Args: { p_date?: string; p_user_ids: string[] }
        Returns: {
          hourly_wage: number
          user_id: string
        }[]
      }
      get_unread_chat_count: { Args: { _user_id: string }; Returns: number }
      get_user_location_ids: { Args: { _user_id: string }; Returns: string[] }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_active_location_integration: {
        Args: { _integration_type: string; _location_id: string }
        Returns: boolean
      }
      has_brand_access: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      has_brand_access_via_location: {
        Args: { _location_id: string; _user_id: string }
        Returns: boolean
      }
      has_location_access: {
        Args: { _location_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_or_higher: {
        Args: { _minimum_role: string; _user_id: string }
        Returns: boolean
      }
      increment_croo_cash: {
        Args: { amount: number; user_id: string }
        Returns: undefined
      }
      is_brand_admin: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_brand_or_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_chat_member: {
        Args: { _chat_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_active: { Args: { _org_id: string }; Returns: boolean }
      is_org_admin: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      queue_nightly_emails: { Args: never; Returns: undefined }
      queue_nightly_maintenance: { Args: never; Returns: undefined }
      refresh_all_pfg_tokens: { Args: never; Returns: undefined }
      revise_read_and_sign_document: {
        Args: { p_document_id: string; p_user_id: string }
        Returns: undefined
      }
      send_hourly_sales_pulse: { Args: never; Returns: undefined }
      trigger_alarm_tasks_sql: { Args: never; Returns: undefined }
      validate_location_code: {
        Args: { p_code: string }
        Returns: {
          id: string
          name: string
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "manager"
        | "team_member"
        | "general_manager"
        | "shift_manager"
        | "super_admin"
        | "org_admin"
        | "brand_admin"
        | "fbc"
      applicant_flag_color: "none" | "green" | "yellow" | "red"
      application_status:
        | "pending"
        | "interested"
        | "interviewing"
        | "hired"
        | "rejected"
      i9_document_type:
        | "photo_id"
        | "ssn_card"
        | "work_authorization"
        | "passport"
      i9_request_status: "pending" | "uploaded" | "retrieved" | "expired"
      support_ticket_category:
        | "ui_glitch"
        | "broken_feature"
        | "login_issues"
        | "data_sync_issues"
        | "notification_issues"
        | "scheduling_issues"
        | "other"
      support_ticket_status: "open" | "in_progress" | "resolved"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "manager",
        "team_member",
        "general_manager",
        "shift_manager",
        "super_admin",
        "org_admin",
        "brand_admin",
        "fbc",
      ],
      applicant_flag_color: ["none", "green", "yellow", "red"],
      application_status: [
        "pending",
        "interested",
        "interviewing",
        "hired",
        "rejected",
      ],
      i9_document_type: [
        "photo_id",
        "ssn_card",
        "work_authorization",
        "passport",
      ],
      i9_request_status: ["pending", "uploaded", "retrieved", "expired"],
      support_ticket_category: [
        "ui_glitch",
        "broken_feature",
        "login_issues",
        "data_sync_issues",
        "notification_issues",
        "scheduling_issues",
        "other",
      ],
      support_ticket_status: ["open", "in_progress", "resolved"],
    },
  },
} as const
