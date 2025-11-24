-- Add foreign key from messages.sender_id to profiles.id
ALTER TABLE public.messages
ADD CONSTRAINT messages_sender_id_fkey
FOREIGN KEY (sender_id) REFERENCES public.profiles(id);

-- Add foreign key from chats.created_by to profiles.id  
ALTER TABLE public.chats
ADD CONSTRAINT chats_created_by_fkey
FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- Add foreign key from chat_members.user_id to profiles.id
ALTER TABLE public.chat_members
ADD CONSTRAINT chat_members_user_id_fkey
FOREIGN KEY (user_id) REFERENCES public.profiles(id);