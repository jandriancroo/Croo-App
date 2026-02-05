 import { useState } from "react";
 import { Card } from "@/components/ui/card";
 import { Badge } from "@/components/ui/badge";
 import { Checkbox } from "@/components/ui/checkbox";
 import { Button } from "@/components/ui/button";
 import { Calendar, Clock, User, ChevronRight } from "lucide-react";
 import { format, subDays, addDays } from "date-fns";
 
 // Mock data for preview
 const mockRequests = [
   {
     id: "1",
     employee: "Sarah Johnson",
     requestType: "paid",
     status: "pending",
     startDate: addDays(new Date(), 3),
     endDate: addDays(new Date(), 5),
     hoursRequested: 24,
     createdAt: subDays(new Date(), 2),
     timeScope: "multi_day",
   },
   {
     id: "2",
     employee: "Mike Chen",
     requestType: "unpaid",
     status: "approved",
     startDate: addDays(new Date(), 7),
     endDate: null,
     hoursRequested: 8,
     createdAt: subDays(new Date(), 1),
     timeScope: "full_day",
   },
   {
     id: "3",
     employee: "Emily Davis",
     requestType: "paid",
     status: "pending",
     startDate: subDays(new Date(), 5),
     endDate: subDays(new Date(), 4),
     hoursRequested: 16,
     createdAt: subDays(new Date(), 10),
     timeScope: "multi_day",
   },
 ];
 
 const AvailabilityRequestPreview = () => {
   const [hidePast, setHidePast] = useState(false);
 
   const filteredRequests = hidePast
     ? mockRequests.filter((r) => r.startDate >= new Date())
     : mockRequests;
 
   return (
     <div className="min-h-screen bg-background p-6">
       <h1 className="text-2xl font-bold mb-2 text-center">
         Availability Request List Redesign
       </h1>
       <p className="text-muted-foreground text-center mb-8">
         Choose a layout style for the availability request list
       </p>
 
       {/* Hide Past Requests Toggle - Shared */}
       <div className="flex items-center gap-2 justify-center mb-6">
         <Checkbox
           id="hide-past"
           checked={hidePast}
           onCheckedChange={(checked) => setHidePast(checked === true)}
         />
         <label htmlFor="hide-past" className="text-sm cursor-pointer">
           Hide past requests
         </label>
       </div>
 
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
         {/* Option 1: Timeline Style */}
         <div className="space-y-3">
           <h2 className="text-lg font-semibold text-center">
             Option 1: Timeline Style
           </h2>
           <p className="text-xs text-muted-foreground text-center mb-4">
             Request date as subtle timestamp, dates prominently displayed
           </p>
           <Card className="p-4">
             <div className="space-y-4">
               {filteredRequests.map((request) => (
                 <div
                   key={request.id}
                   className="relative pl-4 border-l-2 border-muted pb-4 last:pb-0"
                 >
                   {/* Subtle request timestamp */}
                   <span className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-primary" />
                   <div className="text-[10px] text-muted-foreground/60 mb-1">
                     Requested {format(request.createdAt, "MMM d")}
                   </div>
 
                   {/* Main content */}
                   <div className="flex items-start justify-between gap-3">
                     <div>
                       <div className="font-medium text-sm">{request.employee}</div>
                       <div className="flex items-center gap-1.5 mt-1">
                         <Calendar className="h-3.5 w-3.5 text-primary" />
                         <span className="text-sm font-medium">
                           {format(request.startDate, "MMM d")}
                           {request.endDate &&
                             ` - ${format(request.endDate, "MMM d")}`}
                         </span>
                       </div>
                       <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                         <Clock className="h-3 w-3" />
                         {request.hoursRequested} hours
                       </div>
                     </div>
                     <div className="flex flex-col items-end gap-1">
                       <Badge
                         variant={request.requestType === "paid" ? "default" : "secondary"}
                         className="text-[10px] px-1.5"
                       >
                         {request.requestType}
                       </Badge>
                       <Badge
                         variant={
                           request.status === "approved"
                             ? "default"
                             : request.status === "denied"
                             ? "destructive"
                             : "outline"
                         }
                         className="text-[10px] px-1.5"
                       >
                         {request.status}
                       </Badge>
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           </Card>
         </div>
 
         {/* Option 2: Two-Column Split */}
         <div className="space-y-3">
           <h2 className="text-lg font-semibold text-center">
             Option 2: Two-Column Split
           </h2>
           <p className="text-xs text-muted-foreground text-center mb-4">
             Clear visual separation between request info and dates
           </p>
           <Card className="p-4">
             <div className="space-y-3">
               {filteredRequests.map((request) => (
                 <div
                   key={request.id}
                   className="flex border rounded-lg overflow-hidden"
                 >
                   {/* Left: Request metadata (subtle) */}
                   <div className="w-24 bg-muted/30 p-2 text-center flex flex-col justify-center border-r">
                     <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                       Requested
                     </div>
                     <div className="text-xs font-medium">
                       {format(request.createdAt, "MMM d")}
                     </div>
                   </div>
 
                   {/* Right: Main content */}
                   <div className="flex-1 p-3">
                     <div className="flex items-start justify-between">
                       <div>
                         <div className="font-medium text-sm">{request.employee}</div>
                         <div className="flex items-center gap-1.5 mt-1.5 text-primary font-semibold">
                           <Calendar className="h-4 w-4" />
                           <span>
                             {format(request.startDate, "EEE, MMM d")}
                             {request.endDate &&
                               ` → ${format(request.endDate, "EEE, MMM d")}`}
                           </span>
                         </div>
                       </div>
                       <div className="flex flex-col items-end gap-1">
                         <Badge
                           variant={request.requestType === "paid" ? "default" : "secondary"}
                           className="text-[10px]"
                         >
                           {request.requestType}
                         </Badge>
                         <Badge
                           variant={
                             request.status === "approved"
                               ? "default"
                               : request.status === "denied"
                               ? "destructive"
                               : "outline"
                           }
                           className="text-[10px]"
                         >
                           {request.status}
                         </Badge>
                       </div>
                     </div>
                     <div className="text-xs text-muted-foreground mt-1.5">
                       {request.hoursRequested} hours • {request.requestType}
                     </div>
                   </div>
                 </div>
               ))}
             </div>
           </Card>
         </div>
 
         {/* Option 3: Compact Table-Like */}
         <div className="space-y-3">
           <h2 className="text-lg font-semibold text-center">
             Option 3: Compact Row
           </h2>
           <p className="text-xs text-muted-foreground text-center mb-4">
             Dense layout with request date as trailing footnote
           </p>
           <Card className="p-4">
             <div className="space-y-2">
               {filteredRequests.map((request) => (
                 <div
                   key={request.id}
                   className="p-3 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors"
                 >
                   <div className="flex items-center justify-between gap-3">
                     {/* Employee & Status */}
                     <div className="flex items-center gap-2 min-w-0">
                       <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                         <User className="h-4 w-4 text-primary" />
                       </div>
                       <div className="min-w-0">
                         <div className="font-medium text-sm truncate">
                           {request.employee}
                         </div>
                         <div className="flex items-center gap-1.5">
                           <Badge
                             variant={
                               request.status === "approved"
                                 ? "default"
                                 : request.status === "denied"
                                 ? "destructive"
                                 : "outline"
                             }
                             className="text-[10px] px-1.5 py-0"
                           >
                             {request.status}
                           </Badge>
                           <Badge
                             variant="secondary"
                             className="text-[10px] px-1.5 py-0"
                           >
                             {request.requestType}
                           </Badge>
                         </div>
                       </div>
                     </div>
 
                     {/* Dates - Primary focus */}
                     <div className="text-right shrink-0">
                       <div className="font-semibold text-sm text-primary">
                         {format(request.startDate, "MMM d")}
                         {request.endDate && ` - ${format(request.endDate, "d")}`}
                       </div>
                       <div className="text-[10px] text-muted-foreground/50">
                         req. {format(request.createdAt, "M/d")}
                       </div>
                     </div>
 
                     <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
                   </div>
                 </div>
               ))}
             </div>
           </Card>
         </div>
       </div>
 
       <div className="text-center mt-8 text-sm text-muted-foreground">
         Pick a style and we'll apply it to both desktop and mobile views
       </div>
     </div>
   );
 };
 
 export default AvailabilityRequestPreview;