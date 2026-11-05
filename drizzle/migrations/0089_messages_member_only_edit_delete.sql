drop policy "Users can delete their own messages" on public.messages;
create policy "Users can delete their own messages"
on public.messages for delete to authenticated
using (
  auth.uid() = sender_id
  and exists (
    select 1 from public.chat_members cm
    where cm.chat_id = messages.chat_id and cm.user_id = auth.uid()
  )
);

drop policy "Users can update their own messages" on public.messages;
create policy "Users can update their own messages"
on public.messages for update to authenticated
using (
  auth.uid() = sender_id
  and exists (
    select 1 from public.chat_members cm
    where cm.chat_id = messages.chat_id and cm.user_id = auth.uid()
  )
);