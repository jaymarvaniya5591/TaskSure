"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUserContext } from "@/lib/user-context";
import { User, Building, Phone, ShieldCheck, CheckCircle2, X } from "lucide-react";

interface UserProfile {
    id: string;
    name: string;
    phone_number: string;
    reporting_manager_id: string | null;
    organisation_id: string | null;
    organisation?: { name: string } | null;
    manager?: { name: string; phone_number: string } | null;
}

export default function ProfilePage() {
    const { userId } = useUserContext();
    const [supabase] = useState(() => createClient());

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Edit states
    const [isEditingName, setIsEditingName] = useState(false);
    const [editName, setEditName] = useState("");

    const [isEditingPhone, setIsEditingPhone] = useState(false);
    const [editPhone, setEditPhone] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [otp, setOtp] = useState("");

    const [isEditingManager, setIsEditingManager] = useState(false);
    const [newManagerPhone, setNewManagerPhone] = useState("");
    const [managerVerifySent, setManagerVerifySent] = useState(false);

    const [isEditingCompany, setIsEditingCompany] = useState(false);
    const [companyAction, setCompanyAction] = useState<"join" | "create" | null>(null);
    const [newCompanyName, setNewCompanyName] = useState("");
    const [managerForCompanyPhone, setManagerForCompanyPhone] = useState("");
    const [companyVerifySent, setCompanyVerifySent] = useState(false);

    useEffect(() => {
        async function loadProfile() {
            if (!userId) return;
            try {
                // Fetch the basic user profile
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('id, name, phone_number, reporting_manager_id, organisation_id')
                    .eq('id', userId)
                    .single();

                if (userError) throw userError;

                let orgName = null;
                let managerInfo = null;

                if (userData.organisation_id) {
                    const { data: orgData } = await supabase
                        .from('organisations')
                        .select('name')
                        .eq('id', userData.organisation_id)
                        .single();
                    if (orgData) orgName = orgData.name;
                }

                if (userData.reporting_manager_id) {
                    const { data: managerData } = await supabase
                        .from('users')
                        .select('name, phone_number')
                        .eq('id', userData.reporting_manager_id)
                        .single();
                    if (managerData) managerInfo = managerData;
                }

                const formattedProfile: UserProfile = {
                    ...userData,
                    phone_number: (userData.phone_number || "").replace(/^\+91/, "").replace(/\D/g, ""),
                    organisation: orgName ? { name: orgName } : null,
                    manager: managerInfo ? { ...managerInfo, phone_number: (managerInfo.phone_number || "").replace(/^\+91/, "").replace(/\D/g, "") } : null,
                };

                setProfile(formattedProfile);
                setEditName(formattedProfile.name || "");
                setEditPhone(formattedProfile.phone_number || "");
            } catch (err) {
                console.error("Failed to load profile", err);
            } finally {
                setIsLoading(false);
            }
        }
        loadProfile();
    }, [supabase, userId]);

    // Name Update
    const handleSaveName = async () => {
        if (!editName.trim()) return alert("Name cannot be empty");
        const { error } = await supabase.from('users').update({ name: editName }).eq('id', userId);
        if (error) {
            alert("Failed to update name");
        } else {
            alert("Name updated successfully!");
            setProfile(prev => prev ? { ...prev, name: editName } : null);
            setIsEditingName(false);
        }
    };

    // Phone Update (Mock OTP)
    const handleSendPhoneOtp = () => {
        if (!editPhone || editPhone.length < 10) return alert("Enter a valid phone number");
        setOtpSent(true);
        alert("OTP sent to new phone number!");
    };

    const handleVerifyPhone = async () => {
        if (otp !== "123456") return alert("Invalid OTP. Try 123456.");
        const { error } = await supabase.from('users').update({ phone_number: editPhone }).eq('id', userId);
        if (error) {
            alert("Failed to update phone");
        } else {
            alert("Phone number verified and updated!");
            setProfile(prev => prev ? { ...prev, phone_number: editPhone } : null);
            setIsEditingPhone(false);
            setOtpSent(false);
            setOtp("");
        }
    };

    // Manager Update (Mock Approval)
    const handleRequestManagerChange = () => {
        if (!newManagerPhone || newManagerPhone.length < 10) return alert("Enter a valid manager phone number");
        setManagerVerifySent(true);
        alert("Verification request sent to new manager on WhatsApp!");
        setTimeout(() => {
            setIsEditingManager(false);
            setManagerVerifySent(false);
            setNewManagerPhone("");
        }, 3000);
    };

    // Company Update (Mock Logic)
    const handleCompanySubmit = () => {
        if (companyAction === "create") {
            if (!newCompanyName) return alert("Enter a company name");
            alert("New company created! (Mock)");
            setIsEditingCompany(false);
            setCompanyAction(null);
        } else if (companyAction === "join") {
            if (!managerForCompanyPhone) return alert("Enter manager's phone number to join");
            setCompanyVerifySent(true);
            alert("Verification request sent to manager on WhatsApp!");
            setTimeout(() => {
                setIsEditingCompany(false);
                setCompanyAction(null);
                setCompanyVerifySent(false);
            }, 3000);
        }
    };

    if (isLoading) {
        return <div className="p-8 text-center text-gray-500 font-medium">Loading profile...</div>;
    }

    if (!profile) return null;

    /* ────────────────────────────────────────────────────────────────────────
       Shared style tokens for uniformity & readability
       ──────────────────────────────────────────────────────────────────────── */
    const sectionCard = "bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-100";
    const sectionIcon = "w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0 flex items-center justify-center";
    const sectionLabel = "text-xs sm:text-sm font-bold text-gray-500 uppercase tracking-wider";
    const inputBase = "w-full h-12 border border-gray-200 rounded-xl px-4 text-sm sm:text-[15px] font-semibold focus:border-gray-400 focus:ring-0 outline-none transition-colors bg-white";
    const btnPrimary = "h-12 px-6 rounded-xl text-sm font-bold flex items-center justify-center transition-colors whitespace-nowrap";
    const btnCancel = "h-10 w-10 shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors";
    const valueDisplay = "text-base sm:text-lg font-bold text-gray-900 break-words";

    return (
        <div className="max-w-3xl mx-auto pb-12 animate-fade-in-up">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight mb-6 sm:mb-8">
                Your Profile
            </h1>

            <div className="space-y-4 sm:space-y-6">

                {/* ── 1. Name Section ── */}
                <div className={sectionCard}>
                    <div className="flex items-start gap-3 sm:gap-4">
                        <div className={`${sectionIcon} bg-blue-50 text-blue-600`}>
                            <User className="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className={sectionLabel}>Full Name</h2>
                            <div className="mt-2">
                                {isEditingName ? (
                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            className={inputBase}
                                            placeholder="First and Last Name"
                                        />
                                        <div className="flex items-center gap-2">
                                            <button onClick={handleSaveName} className={`${btnPrimary} flex-1 bg-blue-600 text-white hover:bg-blue-700`}>Save</button>
                                            <button onClick={() => setIsEditingName(false)} className={btnCancel}><X className="w-5 h-5" /></button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-3 min-h-[44px]">
                                        <p className={valueDisplay}>{profile.name}</p>
                                        <button onClick={() => setIsEditingName(true)} className={`${btnPrimary} bg-blue-50 text-blue-600 hover:bg-blue-100`}>Edit</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── 2. Phone Number Section ── */}
                <div className={sectionCard}>
                    <div className="flex items-start gap-3 sm:gap-4">
                        <div className={`${sectionIcon} bg-green-50 text-green-600`}>
                            <Phone className="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className={sectionLabel}>Phone Number</h2>
                            <div className="mt-2">
                                {isEditingPhone ? (
                                    <div className="space-y-3">
                                        <input
                                            type={otpSent ? "text" : "tel"}
                                            value={otpSent ? otp : editPhone}
                                            onChange={(e) => otpSent ? setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)) : setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                            className={inputBase}
                                            placeholder={otpSent ? "Enter 6-digit OTP" : "10-digit phone number"}
                                            maxLength={otpSent ? 6 : 10}
                                        />
                                        <div className="flex items-center gap-2">
                                            {otpSent ? (
                                                <button onClick={handleVerifyPhone} className={`${btnPrimary} flex-1 bg-gray-900 text-white hover:bg-gray-800`}>Verify</button>
                                            ) : (
                                                <button onClick={handleSendPhoneOtp} className={`${btnPrimary} flex-1 bg-green-600 text-white hover:bg-green-700`}>Send OTP</button>
                                            )}
                                            <button onClick={() => { setIsEditingPhone(false); setOtpSent(false); }} className={btnCancel}><X className="w-5 h-5" /></button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-3 min-h-[44px]">
                                        <div className="flex items-center gap-2">
                                            <p className={valueDisplay}>{profile.phone_number || "Not set"}</p>
                                            {profile.phone_number && <CheckCircle2 className="shrink-0 w-4 h-4 sm:w-5 sm:h-5 text-green-600" />}
                                        </div>
                                        <button onClick={() => { setIsEditingPhone(true); setOtpSent(false); }} className={`${btnPrimary} bg-green-50 text-green-600 hover:bg-green-100`}>Edit</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── 3. Manager Section ── */}
                <div className={sectionCard}>
                    <div className="flex items-start gap-3 sm:gap-4">
                        <div className={`${sectionIcon} bg-purple-50 text-purple-600`}>
                            <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className={sectionLabel}>Your Manager</h2>
                            <div className="mt-2">
                                {isEditingManager ? (
                                    <div className="space-y-3">
                                        {managerVerifySent ? (
                                            <div className="w-full h-12 flex items-center px-4 bg-amber-50 border border-amber-100 rounded-xl text-sm font-medium text-amber-600">Pending approval from manager</div>
                                        ) : (
                                            <input
                                                type="tel"
                                                value={newManagerPhone}
                                                onChange={(e) => setNewManagerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                                className={inputBase}
                                                placeholder="Manager's 10-digit phone number"
                                                maxLength={10}
                                            />
                                        )}
                                        <div className="flex items-center gap-2">
                                            {!managerVerifySent && (
                                                <button onClick={handleRequestManagerChange} className={`${btnPrimary} flex-1 bg-purple-600 text-white hover:bg-purple-700`}>Send Request</button>
                                            )}
                                            <button onClick={() => setIsEditingManager(false)} className={btnCancel}><X className="w-5 h-5" /></button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-3 min-h-[44px]">
                                        {profile.manager ? (
                                            <p className={valueDisplay}>{profile.manager.name}</p>
                                        ) : (
                                            <p className="text-base font-bold text-gray-400 italic">No manager assigned</p>
                                        )}
                                        <button onClick={() => { setIsEditingManager(true); setNewManagerPhone(profile.manager?.phone_number || ''); }} className={`${btnPrimary} bg-purple-50 text-purple-600 hover:bg-purple-100`}>Edit</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── 4. Company Section ── */}
                <div className={sectionCard}>
                    <div className="flex items-start gap-3 sm:gap-4">
                        <div className={`${sectionIcon} bg-orange-50 text-orange-600`}>
                            <Building className="w-5 h-5 sm:w-6 sm:h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className={sectionLabel}>Company / Organisation</h2>
                            <div className="mt-2">
                                {isEditingCompany ? (
                                    <div className="space-y-3">
                                        {!companyAction ? (
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => setCompanyAction('join')} className="flex-1 h-12 border border-gray-200 bg-gray-50 hover:bg-gray-100 rounded-xl text-sm font-bold text-gray-700 transition-colors">Join Existing</button>
                                                <button onClick={() => setCompanyAction('create')} className="flex-1 h-12 border border-gray-200 bg-gray-50 hover:bg-gray-100 rounded-xl text-sm font-bold text-gray-700 transition-colors">Create New</button>
                                                <button onClick={() => { setIsEditingCompany(false); setCompanyVerifySent(false); setCompanyAction(null); }} className={btnCancel}><X className="w-5 h-5" /></button>
                                            </div>
                                        ) : companyVerifySent ? (
                                            <div className="w-full h-12 flex items-center px-4 bg-amber-50 border border-amber-100 rounded-xl text-sm font-medium text-amber-600">Pending approval from manager</div>
                                        ) : (
                                            <input
                                                type={companyAction === "join" ? "tel" : "text"}
                                                value={companyAction === "join" ? managerForCompanyPhone : newCompanyName}
                                                onChange={(e) => companyAction === "join" ? setManagerForCompanyPhone(e.target.value.replace(/\D/g, '').slice(0, 10)) : setNewCompanyName(e.target.value)}
                                                className={inputBase}
                                                placeholder={companyAction === "join" ? "Manager's 10-digit phone number" : "Company Name"}
                                                maxLength={companyAction === "join" ? 10 : undefined}
                                            />
                                        )}
                                        {companyAction && (
                                            <div className="flex items-center gap-2">
                                                {!companyVerifySent && (
                                                    <button onClick={handleCompanySubmit} className={`${btnPrimary} flex-1 bg-orange-600 text-white hover:bg-orange-700`}>Submit</button>
                                                )}
                                                <button onClick={() => { setIsEditingCompany(false); setCompanyVerifySent(false); setCompanyAction(null); }} className={btnCancel}><X className="w-5 h-5" /></button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between gap-3 min-h-[44px]">
                                        <p className={valueDisplay}>{profile.organisation?.name || "Independent / Not Assigned"}</p>
                                        <button onClick={() => setIsEditingCompany(true)} className={`${btnPrimary} bg-orange-50 text-orange-600 hover:bg-orange-100`}>Edit</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
