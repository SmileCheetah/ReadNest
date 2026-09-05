import { Controller, Get, Header } from '@nestjs/common';

@Controller('privacy')
export class PrivacyController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getPrivacyPolicy() {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unwind 개인정보처리방침</title></head><body style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222"><h1>Unwind 개인정보처리방침</h1><p>시행일: 2026년 9월 3일</p><p>Unwind(이하 “서비스”)는 Threads 등에서 발견한 글을 저장하고 요약해 다시 읽을 수 있도록 돕는 서비스입니다.</p><h2>1. 수집하는 정보</h2><ul><li>회원가입 및 로그인: 이메일 주소, 닉네임, 비밀번호의 암호화된 저장값</li><li>서비스 이용: 사용자가 저장한 게시물 URL, 게시물 내용 및 읽음 상태</li><li>기기 권한 및 광고 식별자: 수집하지 않습니다.</li></ul><h2>2. 이용 목적</h2><p>회원 인증, 저장 글 관리, 원문 추출 및 AI 요약 제공, 서비스 오류 대응을 위해 정보를 이용합니다.</p><h2>3. 보관 및 삭제</h2><p>정보는 회원이 서비스를 이용하는 동안 보관합니다. 회원 탈퇴 또는 삭제 요청 시 관련 법령상 보관이 필요한 경우를 제외하고 지체 없이 삭제합니다.</p><h2>4. 제3자 제공 및 처리</h2><p>서비스 제공을 위해 저장된 게시물 내용을 원문 추출 및 요약 처리에 사용할 수 있습니다. 법령에 따른 경우를 제외하고 개인정보를 판매하거나 광고 목적으로 제3자에게 제공하지 않습니다.</p><h2>5. 문의</h2><p>개인정보 관련 문의: <a href="mailto:kkzw188372@gmail.com">kkzw188372@gmail.com</a></p><p>본 방침은 서비스 변경 또는 법령 변경에 따라 수정될 수 있으며, 변경 시 이 페이지에 게시합니다.</p></body></html>`;
  }

  @Get('account-deletion')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAccountDeletionPage() {
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unwind 계정 삭제</title></head><body style="font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222"><h1>Unwind 계정 및 데이터 삭제</h1><p>Unwind는 저장한 Threads 글을 다시 읽고 AI로 요약하는 서비스입니다.</p><h2>계정 삭제 요청 방법</h2><p>계정에 등록된 이메일 주소를 사용하여 <a href="mailto:kkzw188372@gmail.com?subject=Unwind%20계정%20삭제%20요청">kkzw188372@gmail.com</a>으로 계정 삭제를 요청해 주세요. 요청 메일에는 “Unwind 계정 삭제 요청”이라는 제목과 가입 이메일 주소를 적어 주세요.</p><p>본인 확인 후 계정과 관련 데이터는 요청을 확인한 날부터 7일 이내에 삭제합니다.</p><h2>삭제되는 데이터</h2><ul><li>이메일 주소와 닉네임</li><li>암호화되어 저장된 비밀번호</li><li>저장한 게시물 URL, 게시물 내용, 읽음 상태</li><li>AI 요약 결과와 서비스 이용 기록</li></ul><h2>보관되는 데이터</h2><p>법률상 보관 의무가 있는 정보가 있는 경우 해당 법령에서 정한 기간 동안만 보관한 후 삭제합니다. 그 외의 계정 및 서비스 데이터는 삭제 요청 처리 후 보관하지 않습니다.</p><h2>Account deletion instructions</h2><p>To request deletion of your Unwind account and associated data, email <a href="mailto:kkzw188372@gmail.com?subject=Unwind%20account%20deletion%20request">kkzw188372@gmail.com</a> from your registered email address. Use the subject “Unwind account deletion request” and include the email address used to sign up.</p><p>After verification, we will delete the account and associated data within 7 days. Data required to be retained by law will be kept only for the legally required retention period.</p><h2>문의</h2><p>개인정보 및 계정 삭제 문의: <a href="mailto:kkzw188372@gmail.com">kkzw188372@gmail.com</a></p></body></html>`;
  }
}

@Controller('account-deletion')
export class AccountDeletionController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAccountDeletionPage() {
    return new PrivacyController().getAccountDeletionPage();
  }
}
