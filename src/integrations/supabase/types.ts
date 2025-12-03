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
      availability_requests: {
        Row: {
          created_at: string
          denial_reason: string | null
          end_date: string | null
          end_time: string | null
          hours_requested: number
          id: string
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
          end_date?: string | null
          end_time?: string | null
          hours_requested?: number
          id?: string
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
          end_date?: string | null
          end_time?: string | null
          hours_requested?: number
          id?: string
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
      chat_members: {
        Row: {
          chat_id: string
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          id?: string
          joined_at?: string
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
          is_group: boolean
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          group_image_url?: string | null
          id?: string
          is_announcement?: boolean
          is_group?: boolean
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          group_image_url?: string | null
          id?: string
          is_announcement?: boolean
          is_group?: boolean
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
          options: Json | null
          order_index: number
          question: string
          reference_image_url: string | null
          reference_link: string | null
          reference_notes: string | null
          reference_video_url: string | null
        }
        Insert: {
          checklist_id: string
          created_at?: string | null
          days_of_week?: number[] | null
          id?: string
          is_required?: boolean | null
          item_type: string
          options?: Json | null
          order_index: number
          question: string
          reference_image_url?: string | null
          reference_link?: string | null
          reference_notes?: string | null
          reference_video_url?: string | null
        }
        Update: {
          checklist_id?: string
          created_at?: string | null
          days_of_week?: number[] | null
          id?: string
          is_required?: boolean | null
          item_type?: string
          options?: Json | null
          order_index?: number
          question?: string
          reference_image_url?: string | null
          reference_link?: string | null
          reference_notes?: string | null
          reference_video_url?: string | null
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
      checklist_responses: {
        Row: {
          completed_by: string | null
          created_at: string | null
          extracted_temperature: number | null
          id: string
          item_id: string
          response_image_url: string | null
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
          notes: string | null
          submitted_at: string | null
          submitted_by: string
        }
        Insert: {
          checklist_id: string
          id?: string
          notes?: string | null
          submitted_at?: string | null
          submitted_by: string
        }
        Update: {
          checklist_id?: string
          id?: string
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
          frequency: string
          id: string
          is_active: boolean | null
          template_type: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_day_of_week?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          due_by_time?: string | null
          frequency: string
          id?: string
          is_active?: boolean | null
          template_type?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_day_of_week?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          due_by_time?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          template_type?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      labor_rules: {
        Row: {
          created_at: string | null
          daily_double_time_threshold: number | null
          daily_overtime_threshold: number | null
          double_time_multiplier: number | null
          id: string
          location_id: string
          meal_break_duration: number | null
          meal_break_hours: number | null
          overtime_multiplier: number | null
          rest_break_duration: number | null
          rest_break_hours: number | null
          rule_name: string
          state_code: string | null
          updated_at: string | null
          weekly_overtime_threshold: number | null
        }
        Insert: {
          created_at?: string | null
          daily_double_time_threshold?: number | null
          daily_overtime_threshold?: number | null
          double_time_multiplier?: number | null
          id?: string
          location_id: string
          meal_break_duration?: number | null
          meal_break_hours?: number | null
          overtime_multiplier?: number | null
          rest_break_duration?: number | null
          rest_break_hours?: number | null
          rule_name: string
          state_code?: string | null
          updated_at?: string | null
          weekly_overtime_threshold?: number | null
        }
        Update: {
          created_at?: string | null
          daily_double_time_threshold?: number | null
          daily_overtime_threshold?: number | null
          double_time_multiplier?: number | null
          id?: string
          location_id?: string
          meal_break_duration?: number | null
          meal_break_hours?: number | null
          overtime_multiplier?: number | null
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
      location_settings: {
        Row: {
          blackout_dates: string[] | null
          created_at: string
          hours_close: string | null
          hours_open: string | null
          id: string
          location_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          blackout_dates?: string[] | null
          created_at?: string
          hours_close?: string | null
          hours_open?: string | null
          id?: string
          location_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          blackout_dates?: string[] | null
          created_at?: string
          hours_close?: string | null
          hours_open?: string | null
          id?: string
          location_id?: string
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
          id: string
          latitude: number | null
          location_code: string | null
          longitude: number | null
          name: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          location_code?: string | null
          longitude?: number | null
          name: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          latitude?: number | null
          location_code?: string | null
          longitude?: number | null
          name?: string
          updated_at?: string
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
          name: string
          updated_at: string
        }
        Insert: {
          alert_enabled?: boolean
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          alert_enabled?: boolean
          created_at?: string
          created_by?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
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
        ]
      }
      logbook_entries: {
        Row: {
          category_id: string
          created_at: string
          created_by: string
          entry_date: string
          id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          created_by: string
          entry_date: string
          id?: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          created_by?: string
          entry_date?: string
          id?: string
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
        }
        Insert: {
          category_id: string
          created_at?: string
          display_order?: number
          field_name: string
          field_type: string
          id?: string
          is_required?: boolean
        }
        Update: {
          category_id?: string
          created_at?: string
          display_order?: number
          field_name?: string
          field_type?: string
          id?: string
          is_required?: boolean
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
          id: string
          parent_message_id: string | null
          sender_id: string
          updated_at: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          chat_id: string
          content?: string | null
          created_at?: string
          id?: string
          parent_message_id?: string | null
          sender_id: string
          updated_at?: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          chat_id?: string
          content?: string | null
          created_at?: string
          id?: string
          parent_message_id?: string | null
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
          certification_expiring: boolean
          chat_messages: boolean
          created_at: string
          id: string
          late_arrivals: boolean
          overdue_checklists: boolean
          schedule_updates: boolean
          shift_approvals: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          announcements?: boolean
          certification_expiring?: boolean
          chat_messages?: boolean
          created_at?: string
          id?: string
          late_arrivals?: boolean
          overdue_checklists?: boolean
          schedule_updates?: boolean
          shift_approvals?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          announcements?: boolean
          certification_expiring?: boolean
          chat_messages?: boolean
          created_at?: string
          id?: string
          late_arrivals?: boolean
          overdue_checklists?: boolean
          schedule_updates?: boolean
          shift_approvals?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      profiles: {
        Row: {
          birthday: string | null
          created_at: string | null
          croo_cash_balance: number
          display_order: number | null
          email: string
          employee_pin: string | null
          full_name: string | null
          hourly_wage: number | null
          id: string
          is_active: boolean | null
          phone_number: string | null
          profile_photo_url: string | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          birthday?: string | null
          created_at?: string | null
          croo_cash_balance?: number
          display_order?: number | null
          email: string
          employee_pin?: string | null
          full_name?: string | null
          hourly_wage?: number | null
          id: string
          is_active?: boolean | null
          phone_number?: string | null
          profile_photo_url?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          birthday?: string | null
          created_at?: string | null
          croo_cash_balance?: number
          display_order?: number | null
          email?: string
          employee_pin?: string | null
          full_name?: string | null
          hourly_wage?: number | null
          id?: string
          is_active?: boolean | null
          phone_number?: string | null
          profile_photo_url?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      schedule_change_log: {
        Row: {
          change_type: string
          created_at: string
          id: string
          new_shift_data: Json | null
          old_shift_data: Json | null
          schedule_id: string
          user_id: string
        }
        Insert: {
          change_type: string
          created_at?: string
          id?: string
          new_shift_data?: Json | null
          old_shift_data?: Json | null
          schedule_id: string
          user_id: string
        }
        Update: {
          change_type?: string
          created_at?: string
          id?: string
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
          created_at: string | null
          day_of_week: number
          event_name: string
          event_time: string
          id: string
          is_recurring: boolean
          notes: string | null
          schedule_id: string | null
          tagged_roles: Json | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          event_name: string
          event_time: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          schedule_id?: string | null
          tagged_roles?: Json | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          event_name?: string
          event_time?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          schedule_id?: string | null
          tagged_roles?: Json | null
        }
        Relationships: [
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
          schedule_id: string | null
          shift_date: string
          start_time: string
          template_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_time_off?: boolean | null
          schedule_id?: string | null
          shift_date: string
          start_time: string
          template_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_time_off?: boolean | null
          schedule_id?: string | null
          shift_date?: string
          start_time?: string
          template_id?: string | null
          user_id?: string | null
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
          published_snapshot?: Json | null
          updated_at?: string | null
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: []
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
          color: string | null
          created_at: string | null
          created_by: string | null
          days_of_week: number[] | null
          end_time: string
          id: string
          position: string | null
          role: Database["public"]["Enums"]["app_role"]
          start_time: string
          template_name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week?: number[] | null
          end_time: string
          id?: string
          position?: string | null
          role: Database["public"]["Enums"]["app_role"]
          start_time: string
          template_name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week?: number[] | null
          end_time?: string
          id?: string
          position?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          start_time?: string
          template_name?: string
        }
        Relationships: []
      }
      time_punches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          id: string
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
          id?: string
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
          id?: string
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
      user_locations: {
        Row: {
          created_at: string
          id: string
          location_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_user_to_location: {
        Args: { p_location_id: string; p_user_id: string }
        Returns: undefined
      }
      generate_location_code: { Args: never; Returns: string }
      generate_unique_pin: { Args: never; Returns: string }
      get_current_wage: {
        Args: { p_date?: string; p_user_id: string }
        Returns: number
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_croo_cash: {
        Args: { amount: number; user_id: string }
        Returns: undefined
      }
      is_chat_member: {
        Args: { _chat_id: string; _user_id: string }
        Returns: boolean
      }
      validate_location_code: {
        Args: { p_code: string }
        Returns: {
          id: string
          name: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "team_member"
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
      app_role: ["admin", "manager", "team_member"],
    },
  },
} as const
